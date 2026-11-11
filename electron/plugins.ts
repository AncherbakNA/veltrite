import fs from "node:fs/promises";
import path from "node:path";
import type { PluginInfo } from "../shared/types";
import { atomicWrite } from "./vault";
export function validatePlugin(value: any): PluginInfo {
  if (
    !value ||
    !/^[-a-z0-9]{1,80}$/.test(value.id) ||
    typeof value.name !== "string" ||
    value.name.length > 100 ||
    typeof value.description !== "string" ||
    typeof value.version !== "string" ||
    !Array.isArray(value.commands) ||
    value.commands.length > 30
  )
    throw Error("Некорректный манифест расширения");
  for (const command of value.commands)
    if (
      !command ||
      typeof command.id !== "string" ||
      typeof command.name !== "string" ||
      !["insert", "create", "open-url"].includes(command.action) ||
      (command.value !== undefined && typeof command.value !== "string")
    )
      throw Error("Расширение содержит неподдерживаемую команду");
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    version: value.version,
    enabled: !!value.enabled,
    commands: value.commands,
  };
}
export class Plugins {
  constructor(private directory: string) {}
  async list(): Promise<PluginInfo[]> {
    try {
      return await Promise.all(
        (await fs.readdir(this.directory))
          .filter((n) => n.endsWith(".json"))
          .map(async (n) =>
            validatePlugin(
              JSON.parse(await fs.readFile(path.join(this.directory, n), "utf8")),
            ),
          ),
      );
    } catch (e: any) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async install(file: string) {
    const stat = await fs.stat(file);
    if (stat.size > 256 * 1024) throw Error("Манифест слишком большой");
    const plugin = validatePlugin(JSON.parse(await fs.readFile(file, "utf8")));
    plugin.enabled = false;
    await atomicWrite(
      path.join(this.directory, plugin.id + ".json"),
      JSON.stringify(plugin, null, 2),
    );
    return plugin;
  }
  async toggle(id: string, enabled: boolean) {
    if (!/^[-a-z0-9]{1,80}$/.test(id)) throw Error("Некорректное расширение");
    const plugin = (await this.list()).find((p) => p.id === id);
    if (!plugin) throw Error("Расширение не найдено");
    await atomicWrite(
      path.join(this.directory, id + ".json"),
      JSON.stringify({ ...plugin, enabled: !!enabled }, null, 2),
    );
  }
}
