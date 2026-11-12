export type Hotkeys = Record<string, string[]>;
export const defaultHotkeys: Hotkeys = {
  "new-note": ["Mod+KeyN"],
  "quick-open": ["Mod+KeyO"],
  commands: ["Mod+KeyP"],
  save: ["Mod+KeyS"],
  sync: ["Mod+Shift+KeyS"],
  settings: ["Mod+Comma"],
  reading: ["Mod+KeyE"],
  search: ["Mod+Shift+KeyF"],
  "tab-close": ["Mod+KeyW"],
  "tab-reopen": ["Mod+Shift+KeyT"],
  "navigation-back": ["Mod+Alt+ArrowLeft"],
  "navigation-forward": ["Mod+Alt+ArrowRight"],
  "editor-bold": ["Mod+KeyB"],
  "editor-italic": ["Mod+KeyI"],
  "editor-link": ["Mod+KeyK"],
  "editor-task": ["Mod+Enter"],
  "editor-strike": ["Mod+Shift+KeyX"],
  "editor-code": ["Mod+Backquote"],
};
const modifiers = ["Mod", "Ctrl", "Alt", "Shift"];
export function normalizeShortcut(shortcut: string): string {
  if (typeof shortcut !== "string" || shortcut.length > 100)
    throw Error("Некорректное сочетание клавиш");
  const parts = shortcut.split("+"),
    code = parts.pop()!;
  if (
    !/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Left|Right|Up|Down)|Comma|Period|Slash|Backslash|BracketLeft|BracketRight|Semicolon|Quote|Backquote|Minus|Equal|Enter|Space|Tab|Home|End|PageUp|PageDown|Backspace|Delete)$/.test(
      code,
    ) ||
    parts.some((part) => !modifiers.includes(part)) ||
    new Set(parts).size !== parts.length ||
    (!parts.some((part) => ["Mod", "Ctrl", "Alt"].includes(part)) && !/^F\d+$/.test(code))
  )
    throw Error("Используйте Ctrl, ⌘, Alt или функциональную клавишу");
  const result = [...modifiers.filter((part) => parts.includes(part)), code].join("+");
  if (/^(?:Mod|Ctrl)\+(?:Key[ACVXYZQHM])$/.test(result) || result === "Alt+F4")
    throw Error("Это сочетание используется системой для редактирования текста или окон");
  return result;
}
export function validateHotkeys(value: unknown): Hotkeys {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 2000
  )
    throw Error("Некорректные горячие клавиши");
  return Object.fromEntries(
    Object.entries(value).map(([id, shortcuts]) => {
      if (
        !/^[\w:.-]{1,240}$/.test(id) ||
        !Array.isArray(shortcuts) ||
        shortcuts.length > 4
      )
        throw Error("Некорректные горячие клавиши");
      return [id, [...new Set(shortcuts.map(normalizeShortcut))]];
    }),
  );
}
export function effectiveHotkeys(custom: Hotkeys): Hotkeys {
  return { ...defaultHotkeys, ...custom };
}
export function eventShortcut(
  event: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): string | null {
  const parts = [
    mac ? (event.metaKey ? "Mod" : "") : event.ctrlKey ? "Mod" : "",
    mac && event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.code,
  ].filter(Boolean);
  try {
    return normalizeShortcut(parts.join("+"));
  } catch {
    return null;
  }
}
export function shortcutLabel(shortcut: string, mac: boolean): string {
  return shortcut
    .replace("Mod+", mac ? "⌘ " : "Ctrl + ")
    .replace("Ctrl+", "Ctrl + ")
    .replace("Alt+", mac ? "⌥ " : "Alt + ")
    .replace("Shift+", "⇧ ")
    .replace(/Key|Digit/g, "")
    .replace("Comma", ",")
    .replace("Backquote", "`")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace(/\+/g, " ");
}
