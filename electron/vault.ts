import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { indexNote, validateCanvas } from "../shared/markdown";
import type { NoteIndex } from "../shared/types";
import {
  defaultPreferences,
  type FileEntry,
  type NoteData,
  type Preferences,
  type Snapshot,
  type VaultInfo,
} from "../shared/types";
import { mapLimit } from "./concurrency";
import { canonicalRoot, ensureParent, relativePath, safePath } from "./paths";
import { mergePreferences } from "./preferences";
import { movedPath, rewriteMarkdownLinks } from "./rename-links";
export const hash = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
export const MAX_FILE = 32 * 1024 * 1024;
export const MAX_VAULT = 512 * 1024 * 1024;
export async function atomicWrite(file: string, data: string | Buffer) {
  await ensureParent(file);
  const tmp = path.join(path.dirname(file), ".veltrite-tmp-" + randomUUID());
  try {
    await fs.writeFile(tmp, data, { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => {});
    return next;
  }
}
export class Vault {
  private noteCache = new Map<
    string,
    { modified: number; size: number; note: NoteIndex }
  >();
  root: string;
  id = "";
  preferences: Preferences = { ...defaultPreferences };
  constructor(root: string) {
    this.root = root;
  }
  private meta(relative: string) {
    return safePath(this.root, ".veltrite/" + relative, true);
  }
  async open(): Promise<VaultInfo> {
    this.root = await canonicalRoot(this.root);
    const meta = await safePath(this.root, ".veltrite", true);
    await fs.mkdir(meta, { recursive: true });
    try {
      const state = JSON.parse(await fs.readFile(await this.meta("vault.json"), "utf8"));
      if (typeof state.id !== "string") throw Error("Повреждён идентификатор хранилища");
      this.id = state.id;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      this.id = randomUUID();
      await atomicWrite(
        await this.meta("vault.json"),
        JSON.stringify({ id: this.id, version: 1 }),
      );
    }
    try {
      this.preferences = mergePreferences(
        defaultPreferences,
        JSON.parse(await fs.readFile(await this.meta("preferences.json"), "utf8")),
      );
    } catch (e: any) {
      if (e.code !== "ENOENT") throw Error("Не удалось прочитать настройки хранилища");
    }
    return this.info();
  }
  async info(): Promise<VaultInfo> {
    return {
      id: this.id,
      name: path.basename(this.root),
      root: this.root,
      files: await this.list(),
      preferences: this.preferences,
    };
  }
  async list(): Promise<FileEntry[]> {
    const result: FileEntry[] = [];
    const walk = async (dir: string, prefix = "") => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name, "ru", { numeric: true }),
      );
      for (const item of entries) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const rel = prefix + item.name;
        try {
          relativePath(rel);
        } catch {
          continue;
        }
        const full = path.join(dir, item.name);
        const stat = await fs.stat(full);
        const ext = path.extname(item.name).toLowerCase();
        result.push({
          path: rel,
          name: item.name,
          kind: item.isDirectory()
            ? "folder"
            : ext === ".md"
              ? "note"
              : ext === ".canvas"
                ? "canvas"
                : ext === ".base"
                  ? "base"
                  : "attachment",
          size: stat.size,
          modified: stat.mtimeMs,
        });
        if (item.isDirectory()) await walk(full, rel + "/");
        if (result.length > 50000) throw Error("Хранилище содержит более 50 000 файлов");
      }
    };
    await walk(this.root);
    return result;
  }
  async read(rel: string): Promise<NoteData> {
    if (!/\.(md|canvas|base)$/i.test(rel))
      throw Error("Этот файл не является заметкой, холстом или базой");
    const full = await safePath(this.root, rel);
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw Error("Файл превышает ограничение 32 МиБ");
    const bytes = await fs.readFile(full);
    return {
      path: rel,
      content: bytes.toString("utf8"),
      revision: hash(bytes),
    };
  }
  async write(rel: string, content: string, revision?: string): Promise<NoteData> {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_FILE)
      throw Error("Файл превышает ограничение 32 МиБ");
    if (!/\.(md|canvas|base)$/i.test(rel)) throw Error("Недопустимый тип файла");
    if (rel.toLowerCase().endsWith(".canvas")) validateCanvas(JSON.parse(content));
    const full = await safePath(this.root, rel);
    let old: Buffer | null = null;
    try {
      old = await fs.readFile(full);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (revision !== undefined && (old === null || hash(old) !== revision))
      throw Error(
        "Файл изменён другой программой. Ваша правка сохранена в редакторе: скопируйте её или создайте копию перед перезагрузкой.",
      );
    if (old && old.toString("utf8") !== content) await this.backup(rel, old);
    await atomicWrite(full, content);
    this.noteCache.delete(rel);
    return { path: rel, content, revision: hash(content) };
  }
  async create(rel: string, content = ""): Promise<NoteData> {
    if (rel.toLowerCase().endsWith(".canvas") && !content)
      content = '{"nodes":[],"edges":[]}';
    const full = await safePath(this.root, rel);
    await this.assertUnique(rel);
    await ensureParent(full);
    if (rel.toLowerCase().endsWith(".canvas"))
      validateCanvas(JSON.parse(content || '{"nodes":[],"edges":[]}'));
    await fs.writeFile(full, content, { flag: "wx", mode: 0o600 });
    return { path: rel, content, revision: hash(content) };
  }
  async assertUnique(rel: string, except?: string) {
    const lower = rel.normalize("NFC").toLowerCase();
    const files = await this.list();
    if (
      files.some(
        (f) => f.path !== except && f.path.normalize("NFC").toLowerCase() === lower,
      )
    )
      throw Error("Файл с таким именем уже существует");
  }
  async mkdir(rel: string) {
    await this.assertUnique(rel);
    await fs.mkdir(await safePath(this.root, rel), { recursive: true });
  }
  async rename(rel: string, to: string) {
    const source = await safePath(this.root, rel),
      destination = await safePath(this.root, to);
    if (to.startsWith(rel + "/"))
      throw Error("Нельзя переместить папку внутрь неё самой");
    await this.assertUnique(to, rel);
    const directory = (await fs.stat(source)).isDirectory();
    const extension = path.extname(rel).toLowerCase();
    if (
      !directory &&
      [".md", ".canvas", ".base"].includes(extension) &&
      path.extname(to).toLowerCase() !== extension
    )
      throw Error(
        "Переименование не меняет формат файла. Сохраните расширение " + extension,
      );
    const oldFiles = await this.list(),
      oldPaths = oldFiles.filter((f) => f.kind !== "folder").map((f) => f.path),
      oldIndex = await this.index();
    await ensureParent(destination);
    await fs.rename(source, destination);
    this.noteCache.clear();
    for (const oldFile of oldFiles.filter((f) =>
      ["note", "canvas", "base"].includes(f.kind),
    )) {
      const newPath = movedPath(oldFile.path, rel, to, directory),
        note = await this.read(newPath);
      let text = note.content;
      if (oldFile.kind === "note")
        text = rewriteMarkdownLinks(
          text,
          oldFile.path,
          newPath,
          rel,
          to,
          directory,
          oldPaths,
          oldIndex,
        );
      else if (oldFile.kind === "canvas") {
        try {
          const canvas = JSON.parse(text);
          let changed = false;
          for (const node of canvas.nodes || [])
            for (const field of ["file", "background"])
              if (typeof node[field] === "string") {
                const replacement = movedPath(node[field], rel, to, directory);
                if (replacement !== node[field]) {
                  node[field] = replacement;
                  changed = true;
                }
              }
          if (changed) text = JSON.stringify(canvas, null, 2);
        } catch {}
      }
      if (text !== note.content) await this.write(newPath, text, note.revision);
      if (newPath !== oldFile.path) await this.moveHistory(oldFile.path, newPath);
    }
    const bookmarks = this.preferences.bookmarks.map((p) =>
      movedPath(p, rel, to, directory),
    );
    if (JSON.stringify(bookmarks) !== JSON.stringify(this.preferences.bookmarks))
      await this.setPreferences({ bookmarks });
  }
  private async moveHistory(from: string, to: string) {
    const source = await this.meta("history/" + hash(from));
    let entries: string[];
    try {
      entries = await fs.readdir(source);
    } catch (error: any) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const name of entries) {
      const value = JSON.parse(
        await fs.readFile(await this.meta(`history/${hash(from)}/${name}`), "utf8"),
      );
      value.path = to;
      await atomicWrite(
        await this.meta(`history/${hash(to)}/${name}`),
        JSON.stringify(value),
      );
    }
    await fs.rm(source, { recursive: true });
  }
  async backup(rel: string, data: Buffer) {
    const folder = await this.meta("history/" + hash(rel));
    await fs.mkdir(folder, { recursive: true });
    const id = Date.now() + "-" + randomUUID().slice(0, 8);
    await atomicWrite(
      await this.meta(`history/${hash(rel)}/${id}.json`),
      JSON.stringify({
        at: new Date().toISOString(),
        path: rel,
        content: data.toString("base64"),
      }),
    );
    const names = (await fs.readdir(folder)).sort().reverse();
    for (const name of names.slice(50))
      await fs.rm(await this.meta(`history/${hash(rel)}/${name}`));
  }
  async history(rel: string) {
    relativePath(rel);
    const dir = await this.meta("history/" + hash(rel));
    try {
      return await Promise.all(
        (await fs.readdir(dir))
          .sort()
          .reverse()
          .map(async (name) => {
            const v = JSON.parse(
              await fs.readFile(await this.meta(`history/${hash(rel)}/${name}`), "utf8"),
            );
            return {
              id: name.replace(".json", ""),
              at: v.at,
              size: Buffer.from(v.content, "base64").length,
            };
          }),
      );
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async historyRead(rel: string, id: string) {
    relativePath(rel);
    if (!/^\d+-[a-f0-9-]+$/.test(id)) throw Error("Некорректная версия");
    const value = JSON.parse(
      await fs.readFile(await this.meta(`history/${hash(rel)}/${id}.json`), "utf8"),
    );
    if (value.path !== rel) throw Error("Версия относится к другому файлу");
    return Buffer.from(value.content, "base64").toString("utf8");
  }
  async trash(rel: string) {
    const full = await safePath(this.root, rel),
      id = Date.now() + "-" + randomUUID();
    const dir = await this.meta("trash/" + id);
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(
      await this.meta(`trash/${id}/meta.json`),
      JSON.stringify({ id, path: rel, at: new Date().toISOString() }),
    );
    await fs.rename(full, await this.meta(`trash/${id}/data`));
  }
  async trashList() {
    const dir = await this.meta("trash");
    try {
      return (
        await Promise.all(
          (await fs.readdir(dir)).map(async (id) =>
            JSON.parse(
              await fs.readFile(await this.meta(`trash/${id}/meta.json`), "utf8"),
            ),
          ),
        )
      ).sort((a, b) => b.at.localeCompare(a.at));
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async restoreTrash(id: string) {
    if (!/^\d+-[a-f0-9-]+$/.test(id)) throw Error("Некорректная запись корзины");
    const dir = await this.meta("trash/" + id),
      meta = JSON.parse(
        await fs.readFile(await this.meta(`trash/${id}/meta.json`), "utf8"),
      );
    await this.assertUnique(meta.path);
    const to = await safePath(this.root, meta.path);
    await ensureParent(to);
    await fs.rename(await this.meta(`trash/${id}/data`), to);
    await fs.rm(dir, { recursive: true });
  }
  async setPreferences(patch: Partial<Preferences>) {
    const next = mergePreferences(this.preferences, patch);
    await atomicWrite(await this.meta("preferences.json"), JSON.stringify(next, null, 2));
    this.preferences = next;
    return next;
  }
  async index() {
    const files = (await this.list()).filter((file) => file.kind === "note");
    const live = new Set(files.map((file) => file.path));
    for (const key of this.noteCache.keys())
      if (!live.has(key)) this.noteCache.delete(key);
    return mapLimit(files, 8, async (file) => {
      const cached = this.noteCache.get(file.path);
      if (cached && cached.size === file.size && cached.modified === file.modified)
        return cached.note;
      const note = indexNote(file.path, (await this.read(file.path)).content);
      this.noteCache.set(file.path, {
        note,
        size: file.size,
        modified: file.modified,
      });
      return note;
    });
  }
  async search(query: string) {
    if (typeof query !== "string" || query.length > 500)
      throw Error("Слишком длинный запрос");
    const tokens = (query.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((token) => {
      const negative = token.startsWith("-");
      return {
        negative,
        value: (negative ? token.slice(1) : token).replace(/"/g, "").toLocaleLowerCase(),
      };
    });
    const results: { path: string; line: number; text: string }[] = [];
    for (const file of (await this.list()).filter((file) => file.kind === "note")) {
      const text = (await this.read(file.path)).content,
        note = indexNote(file.path, text),
        lower = text.toLocaleLowerCase();
      const match = (value: string) =>
        value.startsWith("path:")
          ? file.path.toLocaleLowerCase().includes(value.slice(5))
          : value.startsWith("tag:")
            ? note.tags.some(
                (tag) =>
                  tag.toLocaleLowerCase() === value.slice(4) ||
                  tag.toLocaleLowerCase().startsWith(value.slice(4) + "/"),
              )
            : lower.includes(value) || file.path.toLocaleLowerCase().includes(value);
      if (
        !tokens.every((token) =>
          token.negative ? !match(token.value) : match(token.value),
        )
      )
        continue;
      const terms = tokens
        .filter((token) => !token.negative && !/^(tag|path):/.test(token.value))
        .map((token) => token.value);
      const lines = text.split("\n");
      let count = 0;
      for (let i = 0; i < lines.length && results.length < 500; i++)
        if (
          terms.length &&
          terms.some((term) => lines[i].toLocaleLowerCase().includes(term))
        ) {
          results.push({
            path: file.path,
            line: i + 1,
            text: lines[i].slice(0, 250),
          });
          if (++count >= 5) break;
        }
      if (!count) {
        const line = note.headings[0]?.line || 1;
        results.push({
          path: file.path,
          line,
          text: lines[line - 1]?.slice(0, 250) || "",
        });
      }
      if (results.length >= 500) break;
    }
    return results;
  }
  async snapshot(): Promise<Snapshot> {
    const result: Snapshot = Object.create(null);
    let size = 0;
    const entries = await this.list();
    for (const f of entries.filter((f) => f.kind !== "folder")) {
      if (f.size > MAX_FILE)
        throw Error(`${f.path}: файл больше 32 МиБ, синхронизация остановлена`);
      size += f.size;
      if (size > MAX_VAULT) throw Error("Для этой версии предел синхронизации — 512 МиБ");
      const bytes = await fs.readFile(await safePath(this.root, f.path));
      result[f.path] = { hash: hash(bytes), content: bytes.toString("base64") };
    }
    const shared = {
      ...this.preferences,
      autoSync: false,
      bookmarks: this.preferences.bookmarks,
    };
    const config = Buffer.from(JSON.stringify(shared));
    result[".veltrite/shared.json"] = {
      hash: hash(config),
      content: config.toString("base64"),
    };
    const folders = Buffer.from(
      JSON.stringify(entries.filter((f) => f.kind === "folder").map((f) => f.path)),
    );
    result[".veltrite/folders.json"] = {
      hash: hash(folders),
      content: folders.toString("base64"),
    };
    return result;
  }
  async applySnapshot(next: Snapshot, expected: Snapshot) {
    const current = await this.snapshot();
    if (
      JSON.stringify(Object.entries(current).map(([p, v]) => [p, v.hash])) !==
      JSON.stringify(Object.entries(expected).map(([p, v]) => [p, v.hash]))
    )
      throw Error(
        "Файлы изменились во время синхронизации. Повторите обмен: локальные файлы сохранены.",
      );
    const paths = new Set([...Object.keys(expected), ...Object.keys(next)]);
    for (const rel of paths) {
      if (rel === ".veltrite/shared.json" || rel === ".veltrite/folders.json") continue;
      relativePath(rel);
      await safePath(this.root, rel);
    }
    const decodeFolders = (snapshot: Snapshot): string[] => {
      const value = snapshot[".veltrite/folders.json"];
      if (!value) return [];
      const folders = JSON.parse(Buffer.from(value.content, "base64").toString("utf8"));
      if (!Array.isArray(folders) || folders.some((p) => typeof p !== "string"))
        throw Error("Некорректный список папок");
      for (const folder of folders) relativePath(folder);
      return folders;
    };
    const folders = decodeFolders(next),
      oldFolders = decodeFolders(expected);
    for (const folder of folders)
      await fs.mkdir(await safePath(this.root, folder), { recursive: true });
    const changed: string[] = [];
    try {
      for (const rel of paths) {
        if (
          rel === ".veltrite/shared.json" ||
          rel === ".veltrite/folders.json" ||
          next[rel]?.hash === expected[rel]?.hash
        )
          continue;
        if (expected[rel])
          await this.backup(rel, Buffer.from(expected[rel].content, "base64"));
        const full = await safePath(this.root, rel);
        changed.push(rel);
        if (next[rel]) await atomicWrite(full, Buffer.from(next[rel].content, "base64"));
        else await this.trash(rel);
      }
      if (next[".veltrite/shared.json"]) {
        const settings = JSON.parse(
          Buffer.from(next[".veltrite/shared.json"].content, "base64").toString("utf8"),
        );
        await this.setPreferences({
          ...settings,
          autoSync: this.preferences.autoSync,
        });
      }
      for (const folder of oldFolders
        .filter((p) => !folders.includes(p))
        .sort((a, b) => b.length - a.length))
        try {
          await fs.rmdir(await safePath(this.root, folder));
        } catch (e: any) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
        }
    } catch (e) {
      for (const rel of changed.reverse()) {
        const full = await safePath(this.root, rel);
        if (expected[rel])
          await atomicWrite(full, Buffer.from(expected[rel].content, "base64"));
        else await fs.rm(full, { force: true });
      }
      throw e;
    }
  }
}
