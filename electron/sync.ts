import type { Snapshot, SyncResult } from "../shared/types";
import { decrypt, encrypt, parseRecoveryKey } from "./crypto";
import { GitHub } from "./github";
import { mergeSnapshots } from "./merge";
import { relativePath } from "./paths";
import {
  ObjectPackReader,
  ObjectPackWriter,
  type SyncFileRecord,
  type TreeChange,
} from "./sync-objects";
import { hash, MAX_FILE, MAX_VAULT, Vault } from "./vault";
interface Manifest {
  format: 1 | 2;
  files: Record<string, SyncFileRecord>;
}
export interface SyncCheckpoint {
  repositoryId: number;
  commit: string | null;
  base: Snapshot;
}
const MANIFEST = "veltrite-sync/manifest.enc";
function encodeManifest(manifest: Manifest) {
  const files = Object.fromEntries(
    Object.keys(manifest.files)
      .sort()
      .map((path) => {
        const record = manifest.files[path];
        return [
          path,
          {
            hash: record.hash,
            blob: record.blob,
            object: record.object,
            size: record.size,
            ...(record.item ? { item: record.item } : {}),
          },
        ];
      }),
  );
  return JSON.stringify({ format: manifest.format, files });
}
export async function synchronize(
  vault: Vault,
  github: GitHub,
  recoveryKey: string,
  checkpoint: SyncCheckpoint | null,
  save: (next: SyncCheckpoint) => Promise<void>,
  expectedRepositoryId?: number,
): Promise<SyncResult> {
  const identity = await github.validate(
    checkpoint?.repositoryId ?? expectedRepositoryId,
  );
  const key = parseRecoveryKey(recoveryKey),
    context = "Veltrite/1/repository/" + identity.id;
  let head = await github.head(identity.branch);
  if (!head) {
    await github.initialize(identity.branch);
    head = await github.head(identity.branch);
  }
  if (!head) throw Error("Не удалось создать начальную ревизию");
  await github.verifyHistory(checkpoint?.commit || null, head);
  const tree = await github.tree(head),
    manifestEntry = tree.entries.find((e) => e.path === MANIFEST);
  let manifest: Manifest = { format: 2, files: Object.create(null) },
    remote: Snapshot = Object.create(null);
  if (manifestEntry) {
    manifest = JSON.parse(
      decrypt(await github.blob(manifestEntry.sha), key, context + "/manifest").toString(
        "utf8",
      ),
    );
    if (
      ![1, 2].includes(manifest.format) ||
      !manifest.files ||
      typeof manifest.files !== "object" ||
      Array.isArray(manifest.files) ||
      Object.keys(manifest.files).length > 50000
    )
      throw Error("Неподдерживаемый формат хранилища");
    let total = 0;
    const names = new Set<string>();
    const reader = new ObjectPackReader(github);
    for (const [rel, record] of Object.entries(manifest.files)) {
      if (rel !== ".veltrite/shared.json" && rel !== ".veltrite/folders.json")
        relativePath(rel);
      const folded = rel.normalize("NFC").toLowerCase();
      if (names.has(folded)) throw Error("В хранилище есть несовместимые имена файлов");
      names.add(folded);
      if (
        !record ||
        !Number.isInteger(record.size) ||
        record.size < 0 ||
        record.size > MAX_FILE ||
        !/^[a-f0-9]{64}$/.test(record.hash) ||
        !/^veltrite-sync\/objects\/[a-f0-9]{64}\.(enc|pack)$/.test(record.object) ||
        (record.object.endsWith(".pack")
          ? !/^[a-f0-9]{64}$/.test(record.item || "")
          : record.item !== undefined) ||
        !/^[a-f0-9]{40}$/.test(record.blob)
      )
        throw Error("Некорректная запись синхронизации");
      total += record.size;
      if (total > MAX_VAULT) throw Error("Хранилище превышает 512 МиБ");
      const cached = checkpoint?.base[rel];
      let bytes: Buffer;
      if (cached?.hash === record.hash) bytes = Buffer.from(cached.content, "base64");
      else bytes = decrypt(await reader.read(record), key, context + "/file/" + rel);
      if (bytes.length !== record.size || hash(bytes) !== record.hash)
        throw Error("Повреждённый файл синхронизации");
      remote[rel] = { hash: record.hash, content: bytes.toString("base64") };
    }
  }
  const local = await vault.snapshot();
  const merged = mergeSnapshots(checkpoint?.base || Object.create(null), local, remote);
  const nextManifest: Manifest = { format: 2, files: Object.create(null) };
  const additions: TreeChange[] = [];
  const writer = new ObjectPackWriter(github, nextManifest.files, additions);
  let uploaded = 0,
    downloaded = 0,
    deleted = 0;
  for (const [rel, file] of Object.entries(merged.files)) {
    const bytes = Buffer.from(file.content, "base64");
    if (manifest.files[rel]?.hash === file.hash)
      nextManifest.files[rel] = manifest.files[rel];
    else {
      await writer.add(
        rel,
        encrypt(bytes, key, context + "/file/" + rel),
        file.hash,
        bytes.length,
      );
      uploaded++;
    }
    if (file.hash !== local[rel]?.hash) downloaded++;
  }
  await writer.flush();
  for (const rel of Object.keys(local)) if (!merged.files[rel]) deleted++;
  const live = new Set(Object.values(nextManifest.files).map((f) => f.object));
  for (const entry of tree.entries)
    if (
      entry.type === "blob" &&
      entry.path.startsWith("veltrite-sync/objects/") &&
      !live.has(entry.path)
    )
      additions.push({
        path: entry.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
  let commit = head;
  if (encodeManifest(nextManifest) !== encodeManifest(manifest) || !manifestEntry) {
    const manifestBlob = await github.putBlob(
      encrypt(Buffer.from(encodeManifest(nextManifest)), key, context + "/manifest"),
    );
    additions.push({
      path: MANIFEST,
      mode: "100644",
      type: "blob",
      sha: manifestBlob,
    });
    commit = await github.commit(identity.branch, head, tree.treeSha, additions);
  }
  // Checkpoint записывается только после применения; повтор после сбоя снова выполнит трёхстороннее объединение.
  await vault.applySnapshot(merged.files, local);
  await save({ repositoryId: identity.id, commit, base: merged.files });
  return {
    uploaded,
    downloaded,
    deleted,
    conflicts: merged.conflicts,
    at: new Date().toISOString(),
  };
}
