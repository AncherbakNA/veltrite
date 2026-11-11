import { GitHub } from "./github";
import { hash } from "./vault";

export interface SyncFileRecord {
  hash: string;
  blob: string;
  object: string;
  size: number;
  item?: string;
}
export interface TreeChange {
  path: string;
  mode: string;
  type: string;
  sha: string | null;
}
const PACK_TARGET = 4 * 1024 * 1024;

/** Маленькие шифротексты упакованы вместе: тысячи заметок не требуют тысячи GET. */
export class ObjectPackReader {
  private packs = new Map<string, Record<string, string>>();
  constructor(private github: GitHub) {}
  async read(record: SyncFileRecord): Promise<Buffer> {
    if (!record.item) return this.github.blob(record.blob);
    let objects = this.packs.get(record.blob);
    if (!objects) {
      const pack = JSON.parse((await this.github.blob(record.blob)).toString("utf8"));
      if (
        pack.format !== 1 ||
        !pack.objects ||
        typeof pack.objects !== "object" ||
        Array.isArray(pack.objects) ||
        Object.keys(pack.objects).length > 50000
      )
        throw Error("Некорректный пакет синхронизации");
      objects = pack.objects;
      this.packs.set(record.blob, objects!);
    }
    const encoded = objects![record.item];
    if (typeof encoded !== "string") throw Error("В пакете отсутствует файл");
    const encrypted = Buffer.from(encoded, "base64");
    if (hash(encrypted) !== record.item) throw Error("Повреждённый пакет синхронизации");
    return encrypted;
  }
}
export class ObjectPackWriter {
  private bytes = 0;
  private pending: {
    path: string;
    encrypted: Buffer;
    hash: string;
    size: number;
    item: string;
  }[] = [];
  constructor(
    private github: GitHub,
    private records: Record<string, SyncFileRecord>,
    private changes: TreeChange[],
  ) {}
  async add(path: string, encrypted: Buffer, fileHash: string, size: number) {
    const estimated = Math.ceil((encrypted.length * 4) / 3) + 100;
    if (this.bytes && this.bytes + estimated > PACK_TARGET) await this.flush();
    this.pending.push({
      path,
      encrypted,
      hash: fileHash,
      size,
      item: hash(encrypted),
    });
    this.bytes += estimated;
    if (this.bytes >= PACK_TARGET) await this.flush();
  }
  async flush() {
    if (!this.pending.length) return;
    const data = Buffer.from(
      JSON.stringify({
        format: 1,
        objects: Object.fromEntries(
          this.pending.map((file) => [file.item, file.encrypted.toString("base64")]),
        ),
      }),
    );
    const object = "veltrite-sync/objects/" + hash(data) + ".pack",
      blob = await this.github.putBlob(data);
    this.changes.push({
      path: object,
      mode: "100644",
      type: "blob",
      sha: blob,
    });
    for (const file of this.pending)
      this.records[file.path] = {
        hash: file.hash,
        size: file.size,
        item: file.item,
        object,
        blob,
      };
    this.bytes = 0;
    this.pending = [];
  }
}
