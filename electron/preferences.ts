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
  for (const key of [
    "lineNumbers",
    "spellcheck",
    "autoSync",
    "readableLineLength",
    "vimMode",
  ] as const)
    if (typeof next[key] !== "boolean") throw Error("Некорректные настройки");
  for (const key of ["dailyFolder", "attachmentFolder", "templatesFolder"] as const)
    relativePath(next[key]);
  if (!Array.isArray(next.bookmarks) || next.bookmarks.length > 50000)
    throw Error("Некорректные закладки");
  next.bookmarks = next.bookmarks.map((bookmark) => relativePath(bookmark));
  return next;
}
