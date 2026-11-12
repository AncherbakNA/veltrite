import {
  allBookmarks,
  fromLegacyBookmarks,
  legacyBookmarks,
  mapBookmarks,
  normalizeBookmarks,
} from "../shared/bookmarks";
import { propertyName } from "../shared/frontmatter-edit";
import { validateGraphOptions } from "../shared/graph-options";
import { validateHotkeys } from "../shared/hotkeys";
import { propertyTypes } from "../shared/properties";
import { styleId } from "../shared/styles";
import { validateTheme } from "../shared/themes";
import { defaultPreferences, type Preferences } from "../shared/types";
import { relativePath } from "./paths";

/** The same allowlist applies to local settings and settings received through sync. */
export function mergePreferences(base: Preferences, patch: unknown): Preferences {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw Error("Некорректные настройки");
  const input = patch as Record<string, unknown>;
  const next = Object.fromEntries(
    Object.keys(defaultPreferences).map((key) => [
      key,
      Object.hasOwn(input, key) ? input[key] : base[key as keyof Preferences],
    ]),
  ) as unknown as Preferences;
  if (
    !["dark", "light", "system"].includes(next.theme) ||
    !["serif", "sans", "mono"].includes(next.textFont) ||
    !["last-note", "home"].includes(next.startupView) ||
    !Number.isFinite(next.fontSize) ||
    next.fontSize < 11 ||
    next.fontSize > 28 ||
    !Number.isFinite(next.syncInterval) ||
    next.syncInterval < 60 ||
    next.syncInterval > 86400 ||
    typeof next.accent !== "string" ||
    !/^#[a-f0-9]{6}$/i.test(next.accent)
  )
    throw Error("Некорректные настройки");
  if (
    !next.propertyTypes ||
    typeof next.propertyTypes !== "object" ||
    Array.isArray(next.propertyTypes) ||
    Object.keys(next.propertyTypes).length > 10000
  )
    throw Error("Некорректные типы свойств");
  for (const [key, type] of Object.entries(next.propertyTypes)) {
    propertyName(key);
    if (!Object.hasOwn(propertyTypes, type)) throw Error("Неизвестный тип свойства");
  }
  if (next.cssTheme !== null) styleId(next.cssTheme);
  if (!Array.isArray(next.cssSnippets) || next.cssSnippets.length > 200)
    throw Error("Некорректный список сниппетов");
  next.cssSnippets = [...new Set(next.cssSnippets.map(styleId))];
  if (!Number.isSafeInteger(next.styleRevision) || next.styleRevision < 0)
    throw Error("Некорректная версия стилей");
  next.graph = validateGraphOptions(next.graph);
  next.hotkeys = validateHotkeys(next.hotkeys);
  next.customTheme = next.customTheme == null ? null : validateTheme(next.customTheme);
  for (const key of [
    "lineNumbers",
    "spellcheck",
    "autoSync",
    "readableLineLength",
    "vimMode",
    "dailyOpenOnStartup",
  ] as const)
    if (typeof next[key] !== "boolean") throw Error("Некорректные настройки");
  for (const key of ["dailyFolder", "attachmentFolder", "templatesFolder"] as const) {
    if (typeof next[key] !== "string") throw Error("Некорректная папка");
    const folder = next[key];
    if (folder && !(key === "attachmentFolder" && folder === "."))
      relativePath(
        key === "attachmentFolder" && folder.startsWith("./") ? folder.slice(2) : folder,
      );
  }
  for (const key of ["dailyTemplate", "uniqueTemplate"] as const) {
    if (typeof next[key] !== "string") throw Error("Некорректный шаблон");
    if (next[key]) {
      relativePath(next[key]);
      if (!/\.md$/i.test(next[key])) throw Error("Шаблон должен быть заметкой Markdown");
    }
  }
  for (const key of [
    "dailyFormat",
    "uniqueFormat",
    "templateDateFormat",
    "templateTimeFormat",
  ] as const)
    if (
      typeof next[key] !== "string" ||
      !next[key].trim() ||
      next[key].length > 200 ||
      /[\x00-\x1f]/.test(next[key])
    )
      throw Error("Некорректный формат даты");
  if (!Array.isArray(next.bookmarks) || next.bookmarks.length > 50000)
    throw Error("Некорректные закладки");
  next.bookmarks = next.bookmarks.map((bookmark) => relativePath(bookmark));
  if (Object.hasOwn(input, "bookmarkItems"))
    next.bookmarkItems = normalizeBookmarks(next.bookmarkItems);
  else if (Object.hasOwn(input, "bookmarks")) {
    const paths = new Set(next.bookmarks);
    const retained = mapBookmarks(base.bookmarkItems || [], (item) =>
      item.type === "file" && !item.fragment && !paths.has(item.path) ? null : item,
    );
    const existing = new Set(legacyBookmarks(retained));
    const ids = new Set(allBookmarks(retained).map((item) => item.id));
    const added = fromLegacyBookmarks(
      next.bookmarks.filter((value) => !existing.has(value)),
    ).map((item) => {
      let id = item.id;
      while (ids.has(id)) id += "-new";
      ids.add(id);
      return { ...item, id };
    });
    next.bookmarkItems = [...retained, ...added];
  }
  next.bookmarks = legacyBookmarks(next.bookmarkItems);
  return next;
}
