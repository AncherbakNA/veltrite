export const isMac = /Mac/i.test(navigator.platform);
export const primaryKey = isMac ? "⌘" : "Ctrl";

export function fileTitle(path: string) {
  return path
    .split("/")
    .pop()!
    .replace(/\.(md|canvas|base)$/i, "");
}
