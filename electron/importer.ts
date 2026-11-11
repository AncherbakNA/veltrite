import fs from "node:fs/promises";
import path from "node:path";
import type { ImportResult, Preferences } from "../shared/types";
import { canonicalRoot, relativePath, safePath } from "./paths";
import { Vault } from "./vault";
export async function importObsidian(
  sourceRoot: string,
  destinationRoot: string,
): Promise<ImportResult> {
  const source = await canonicalRoot(sourceRoot),
    destination = await canonicalRoot(destinationRoot);
  if (
    source === destination ||
    destination.startsWith(source + path.sep) ||
    source.startsWith(destination + path.sep)
  )
    throw Error(
      "Исходная папка и папка импорта должны быть разными и не находиться друг в друге",
    );
  if ((await fs.readdir(destination)).filter((n) => n !== ".DS_Store").length)
    throw Error("Для импорта выберите пустую папку");
  const skipped: string[] = [],
    warnings: string[] = [];
  let imported = 0;
  const seen = new Set<string>();
  const walk = async (directory: string, prefix = "") => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.name.startsWith(".")) {
        if (![".DS_Store", ".obsidian", ".git", ".trash"].includes(entry.name))
          skipped.push(rel);
        continue;
      }
      if (entry.isSymbolicLink()) {
        skipped.push(rel + " (символическая ссылка)");
        continue;
      }
      try {
        relativePath(rel);
      } catch {
        skipped.push(rel + " (имя несовместимо с Windows)");
        continue;
      }
      const normalized = rel.normalize("NFC").toLowerCase();
      if (seen.has(normalized)) {
        skipped.push(rel + " (повторяющееся имя)");
        continue;
      }
      seen.add(normalized);
      const dest = await safePath(destination, rel),
        from = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(dest, { recursive: true });
        await walk(from, rel + "/");
      } else if (entry.isFile()) {
        await fs.copyFile(from, dest, fs.constants.COPYFILE_EXCL);
        const attributes = await fs.stat(from);
        await fs.utimes(dest, attributes.atime, attributes.mtime);
        imported++;
      }
    }
  };
  await walk(source);
  const vault = new Vault(destination);
  await vault.open();
  const settings: Partial<Preferences> = {};
  const readConfig = async (name: string) => {
    try {
      const p = await safePath(source, ".obsidian/" + name, true);
      return JSON.parse(await fs.readFile(p, "utf8"));
    } catch {
      return {};
    }
  };
  const app = await readConfig("app.json"),
    daily = await readConfig("daily-notes.json"),
    templates = await readConfig("templates.json");
  for (const [field, value] of [
    ["attachmentFolder", app.attachmentFolderPath],
    ["dailyFolder", daily.folder],
    ["templatesFolder", templates.folder],
  ] as const) {
    if (typeof value === "string" && value) {
      try {
        relativePath(value);
        (settings as any)[field] = value;
      } catch {
        warnings.push(
          `Настройка ${field} оставлена по умолчанию: специальный путь Obsidian`,
        );
      }
    }
  }
  await vault.setPreferences(settings);
  try {
    const plugins = await fs.readdir(await safePath(source, ".obsidian/plugins", true));
    if (plugins.length)
      warnings.push(
        `Обнаружено ${plugins.length} плагинов Obsidian. Их код не запускается автоматически; совместимость требует отдельной проверки.`,
      );
  } catch {}
  warnings.push(
    "Файлы .canvas и .base скопированы без преобразования. Расширенные представления Bases и API плагинов Obsidian могут отличаться.",
  );
  return { imported, skipped, warnings, vault: await vault.info() };
}
