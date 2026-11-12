import fs from "node:fs/promises";
import path from "node:path";
import { validatePlugin, type PluginPermission } from "../shared/extensions";
import type { PluginInfo } from "../shared/types";
import { atomicWrite, Serial } from "./vault";
export { validatePlugin } from "../shared/extensions";
const identifier = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw Error("Некорректное расширение");
  return id;
};
export class Plugins {
  private storageQueues = new Map<string, Serial>();
  constructor(private directory: string) {}
  async list(): Promise<PluginInfo[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const results = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return validatePlugin(
              JSON.parse(
                await this.readFile(path.join(this.directory, name), 256 * 1024),
              ),
            );
          } catch {
            return null;
          }
        }),
    );
    return results.filter((plugin): plugin is PluginInfo => plugin !== null);
  }
  private async readFile(file: string, limit: number) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
      throw Error("Файл расширения слишком большой или не является обычным файлом");
    return fs.readFile(file, "utf8");
  }
  async install(file: string) {
    const selected = await fs.lstat(file);
    if (selected.isSymbolicLink())
      throw Error("Символические ссылки в пакете не поддерживаются");
    const manifest = selected.isDirectory() ? path.join(file, "manifest.json") : file;
    const plugin = validatePlugin(JSON.parse(await this.readFile(manifest, 256 * 1024)));
    const existing = (await this.list()).find((p) => p.id === plugin.id);
    if (plugin.main) {
      const code = await this.readFile(
        path.join(path.dirname(manifest), "main.js"),
        1024 * 1024,
      );
      await atomicWrite(path.join(this.directory, "code", plugin.id + ".js"), code);
    }
    plugin.enabled = false;
    plugin.grants = [];
    delete plugin.error;
    await this.save(plugin);
    if (existing?.main && !plugin.main)
      await fs.rm(path.join(this.directory, "code", plugin.id + ".js"), { force: true });
    return plugin;
  }
  async get(id: string) {
    const plugin = (await this.list()).find((p) => p.id === identifier(id));
    if (!plugin) throw Error("Расширение не найдено");
    return plugin;
  }
  async code(id: string) {
    return this.readFile(
      path.join(this.directory, "code", identifier(id) + ".js"),
      1024 * 1024,
    );
  }
  async save(plugin: PluginInfo) {
    await atomicWrite(
      path.join(this.directory, identifier(plugin.id) + ".json"),
      JSON.stringify(plugin, null, 2),
    );
  }
  async toggle(id: string, enabled: boolean, grants: PluginPermission[] = []) {
    const plugin = await this.get(id);
    if (enabled && plugin.main && plugin.permissions?.some((p) => !grants.includes(p)))
      throw Error("Перед включением подтвердите разрешения расширения");
    plugin.enabled = !!enabled;
    if (plugin.main) plugin.grants = enabled ? [...plugin.permissions!] : [];
    delete plugin.error;
    await this.save(plugin);
    return plugin;
  }
  async fail(id: string, error: string) {
    const plugin = await this.get(id);
    plugin.enabled = false;
    plugin.error = error.slice(0, 500);
    await this.save(plugin);
  }
  async remove(id: string) {
    identifier(id);
    const queue = this.storageQueues.get(id) || new Serial();
    this.storageQueues.set(id, queue);
    await queue.run(() =>
      Promise.all([
        fs.rm(path.join(this.directory, id + ".json"), { force: true }),
        fs.rm(path.join(this.directory, "code", id + ".js"), { force: true }),
        fs.rm(path.join(this.directory, "data", id + ".json"), { force: true }),
      ]),
    );
    this.storageQueues.delete(id);
  }
  async storage(id: string, key: string, value?: unknown): Promise<unknown> {
    identifier(id);
    if (!this.storageQueues.has(id)) this.storageQueues.set(id, new Serial());
    return this.storageQueues.get(id)!.run(() => this.storageValue(id, key, value));
  }
  private async storageValue(id: string, key: string, value?: unknown): Promise<unknown> {
    if (
      typeof key !== "string" ||
      key.length > 128 ||
      !key ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      throw Error("Некорректный ключ настройки");
    const file = path.join(this.directory, "data", id + ".json");
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(await this.readFile(file, 256 * 1024));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    if (value === undefined) return Object.hasOwn(data, key) ? data[key] : null;
    const text = JSON.stringify({ ...data, [key]: value });
    if (Buffer.byteLength(text) > 256 * 1024)
      throw Error("Настройки расширения больше 256 КиБ");
    await atomicWrite(file, text);
    return value;
  }
}
