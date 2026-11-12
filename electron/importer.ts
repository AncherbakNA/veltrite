import fs from "node:fs/promises";
import path from "node:path";
import { importBookmarks } from "../shared/bookmarks";
import { plural } from "../shared/format";
import { importLayout } from "../shared/import-layout";
import { importHotkeys, importPropertyTypes } from "../shared/import-preferences";
import { formatDate } from "../shared/templates";
import type { ImportResult, Preferences } from "../shared/types";
import { canonicalRoot, relativePath, safePath } from "./paths";
import { mergePreferences } from "./preferences";
import type { StyleStore } from "./styles";
import { Vault } from "./vault";
export async function importFolder(
  sourceRoot: string,
  destinationRoot: string,
  styles?: StyleStore,
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
      if ((await fs.stat(p)).size > 1024 * 1024)
        throw Error("Слишком большой файл настроек");
      const value = JSON.parse(await fs.readFile(p, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Некорректный документ настроек");
      return value;
    } catch (error: any) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code))
        warnings.push(
          `Настройки ${name} не перенесены: повреждённый или слишком большой файл`,
        );
      return {};
    }
  };
  const app = await readConfig("app.json"),
    daily = await readConfig("daily-notes.json"),
    templates = await readConfig("templates.json"),
    appearance = await readConfig("appearance.json"),
    unique = await readConfig("zk-prefixer.json");
  const hotkeyImport = importHotkeys(await readConfig("hotkeys.json"));
  settings.hotkeys = hotkeyImport.hotkeys;
  if (hotkeyImport.skipped)
    warnings.push(
      `Не перенесены сочетания для неподдерживаемых команд или клавиш: ${hotkeyImport.skipped}`,
    );
  settings.propertyTypes = importPropertyTypes((await readConfig("types.json")).types);
  const entries = await vault.list(),
    known = new Set(entries.map((entry) => entry.path));
  const accept = (field: keyof Preferences, value: unknown) => {
    try {
      mergePreferences(vault.preferences, { [field]: value });
      (settings as Record<string, unknown>)[field] = value;
    } catch {
      warnings.push(
        `Настройка ${field} оставлена по умолчанию: неподдерживаемое значение`,
      );
    }
  };
  for (const [field, value] of [
    ["attachmentFolder", app.attachmentFolderPath],
    ["dailyFolder", daily.folder],
    ["templatesFolder", templates.folder],
  ] as const) {
    if (typeof value === "string")
      accept(field, value === "/" ? "" : value === "./" ? "." : value);
  }
  for (const [field, value] of [
    ["lineNumbers", app.showLineNumber],
    ["spellcheck", app.spellcheck],
    ["readableLineLength", app.readableLineLength],
    ["vimMode", app.vimMode],
    ["dailyOpenOnStartup", daily.autorun],
  ] as const)
    if (typeof value === "boolean") accept(field, value);
  for (const [field, value] of [
    ["dailyFormat", daily.format],
    ["uniqueFormat", unique.format],
    ["templateDateFormat", templates.dateFormat],
    ["templateTimeFormat", templates.timeFormat],
  ] as const)
    if (typeof value === "string" && value) {
      try {
        if (field === "dailyFormat" || field === "uniqueFormat")
          relativePath(formatDate(new Date(), value));
        accept(field, value);
      } catch {
        warnings.push(`Формат ${field} несовместим с именами файлов Windows`);
      }
    }
  if (typeof daily.template === "string" && daily.template) {
    const template = known.has(daily.template) ? daily.template : daily.template + ".md";
    if (known.has(template)) accept("dailyTemplate", template);
  }
  if (typeof unique.template === "string" && unique.template) {
    const template = known.has(unique.template)
      ? unique.template
      : unique.template + ".md";
    if (known.has(template)) accept("uniqueTemplate", template);
  }
  if (typeof appearance.baseFontSize === "number")
    accept("fontSize", appearance.baseFontSize);
  if (typeof appearance.accentColor === "string")
    accept("accent", appearance.accentColor);
  const themes: Record<string, string> = {
    obsidian: "dark",
    moonstone: "light",
    system: "system",
  };
  if (themes[appearance.theme]) accept("theme", themes[appearance.theme]);
  if (styles) {
    const themeNames: string[] = [];
    try {
      for (const entry of await fs.readdir(
        await safePath(source, ".obsidian/themes", true),
        { withFileTypes: true },
      ))
        if (entry.isDirectory() && !entry.isSymbolicLink()) themeNames.push(entry.name);
    } catch {}
    const enabled = new Set(
        Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets : [],
      ),
      snippets: string[] = [];
    const install = async (rel: string, name: string, kind: "theme" | "snippet") => {
      try {
        const file = await safePath(source, rel, true),
          stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
          throw Error("неподдерживаемый файл или размер больше 1 МиБ");
        return await styles.install(name, await fs.readFile(file, "utf8"), kind);
      } catch {
        warnings.push(
          `CSS «${name}» не перенесён: неподдерживаемое содержимое или размер`,
        );
        return null;
      }
    };
    for (const name of themeNames.slice(0, 100)) {
      const style = await install(
        ".obsidian/themes/" + name + "/theme.css",
        name,
        "theme",
      );
      if (style && name === appearance.cssTheme) settings.cssTheme = style.id;
    }
    try {
      for (const entry of (
        await fs.readdir(await safePath(source, ".obsidian/snippets", true), {
          withFileTypes: true,
        })
      ).slice(0, 100)) {
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".css"))
          continue;
        const name = entry.name.slice(0, -4),
          style = await install(".obsidian/snippets/" + entry.name, name, "snippet");
        if (style && enabled.has(name)) snippets.push(style.id);
      }
    } catch {}
    settings.cssSnippets = snippets;
    settings.styleRevision = Date.now();
  }
  const bookmarkConfig = await readConfig("bookmarks.json"),
    legacy = await readConfig("starred.json");
  const bookmarks = importBookmarks(bookmarkConfig.items || legacy.items || [], known);
  settings.bookmarkItems = bookmarks.items;
  if (bookmarks.skipped)
    warnings.push(
      `Некоторые закладки не перенесены: ${bookmarks.skipped}. Проверьте ссылки на отсутствующие файлы.`,
    );
  const workspaceConfig = await readConfig("workspace.json"),
    workspace = importLayout(workspaceConfig, known);
  const saved = await readConfig("workspaces.json");
  const workspaces = Object.entries(saved.workspaces || {})
    .slice(0, 20)
    .flatMap(([name, layout]) => {
      const result = importLayout(layout, known);
      return result ? [{ ...result, name: name.slice(0, 100) }] : [];
    });
  await vault.setPreferences(settings);
  try {
    const plugins = await fs.readdir(await safePath(source, ".obsidian/plugins", true));
    if (plugins.length)
      warnings.push(
        `Обнаружено ${plural(plugins.length, ["плагин", "плагина", "плагинов"])}. Они не входят в импорт; используйте расширения Veltrite.`,
      );
  } catch {}
  return {
    imported,
    skipped,
    warnings,
    vault: await vault.info(),
    ...(workspace ? { session: workspace } : {}),
    workspaces,
  };
}
