import { propertyName } from "./frontmatter-edit";
import { normalizeShortcut, type Hotkeys } from "./hotkeys";
import type { PropertyType } from "./properties";
const commandIds: Record<string, string> = {
  "app:go-back": "navigation-back",
  "app:go-forward": "navigation-forward",
  "app:open-settings": "settings",
  "app:open-help": "",
  "app:open-vault": "open-vault",
  "workspace:close": "tab-close",
  "workspace:undo-close-pane": "tab-reopen",
  "workspace:split-vertical": "pane-right",
  "workspace:split-horizontal": "pane-below",
  "workspace:close-pane": "pane-close",
  "file-explorer:new-file": "new-note",
  "file-explorer:new-folder": "new-folder",
  "file-explorer:reveal-active-file": "reveal",
  "switcher:open": "quick-open",
  "command-palette:open": "commands",
  "global-search:open": "search",
  "graph:open": "graph",
  "daily-notes": "daily",
  "daily-notes:open": "daily",
  "random-note:open": "random",
  "templates:insert-template": "template",
  "zk-prefixer": "unique",
  "zk-prefixer:insert": "unique",
  "canvas:new-file": "new-canvas",
  "bases:new-file": "new-base",
  "bookmarks:bookmark-current-view": "bookmark",
  "markdown:toggle-preview": "reading",
  "editor:toggle-source": "source",
  "editor:save-file": "save",
  "editor:attach-file": "attachment",
  "editor:toggle-bold": "editor-bold",
  "editor:toggle-italics": "editor-italic",
  "editor:toggle-strikethrough": "editor-strike",
  "editor:toggle-highlight": "editor-highlight",
  "editor:toggle-code": "editor-code",
  "editor:insert-link": "editor-link",
  "editor:toggle-checklist-status": "editor-task",
  "editor:fold-all": "editor-fold",
  "editor:unfold-all": "editor-unfold",
  "editor:insert-callout": "editor-callout",
};
const codes: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  " ": "Space",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
};
export function importHotkeys(input: unknown): { hotkeys: Hotkeys; skipped: number } {
  const hotkeys: Hotkeys = {};
  let skipped = 0;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { hotkeys, skipped };
  for (const [oldId, values] of Object.entries(input).slice(0, 2000)) {
    const id = commandIds[oldId];
    if (!id || !Array.isArray(values)) {
      skipped++;
      continue;
    }
    const result: string[] = [];
    for (const value of values.slice(0, 4)) {
      try {
        if (!value || !Array.isArray(value.modifiers) || typeof value.key !== "string")
          throw Error();
        const key = /^[a-z]$/i.test(value.key)
          ? "Key" + value.key.toUpperCase()
          : /^\d$/.test(value.key)
            ? "Digit" + value.key
            : codes[value.key] || value.key;
        const modifiers = value.modifiers.map((modifier: string) =>
          modifier === "Meta" ? "Mod" : modifier === "Control" ? "Ctrl" : modifier,
        );
        result.push(normalizeShortcut([...modifiers, key].join("+")));
      } catch {
        skipped++;
      }
    }
    if (!values.length || result.length) hotkeys[id] = [...new Set(result)];
  }
  return { hotkeys, skipped };
}
export function importPropertyTypes(input: unknown): Record<string, PropertyType> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const names: Record<string, PropertyType> = {
    text: "text",
    multitext: "list",
    number: "number",
    checkbox: "checkbox",
    date: "date",
    datetime: "datetime",
    aliases: "list",
    tags: "tags",
  };
  const result: Record<string, PropertyType> = Object.create(null);
  for (const [name, type] of Object.entries(input).slice(0, 10000)) {
    try {
      propertyName(name);
      if (typeof type === "string" && names[type])
        result[name] = name === "tags" ? "tags" : names[type];
    } catch {}
  }
  return result;
}
