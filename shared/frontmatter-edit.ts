import { isMap, isScalar, parseDocument } from "yaml";
export interface PropertyChange {
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: { from: string; to: string };
}
export function propertyName(name: string): string {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 200 ||
    /[\x00-\x1f]/.test(name) ||
    ["__proto__", "constructor", "prototype"].includes(name)
  )
    throw Error("Некорректное имя свойства");
  return name;
}
/** Keep YAML comments/order rather than reconstructing every property from plain JSON. */
export function editFrontmatter(content: string, change: PropertyChange): string {
  const match = /^---\r?\n([^]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (/^---\r?\n/.test(content) && !match)
    throw Error("Исправьте незакрытый блок свойств YAML");
  const doc = parseDocument(match?.[1] || "");
  if (doc.errors.length || (doc.contents && !isMap(doc.contents)))
    throw Error("Исправьте свойства YAML перед редактированием");
  doc.toJS({ maxAliasCount: 30 });
  if (change.rename) {
    const { from, to } = change.rename;
    propertyName(from);
    propertyName(to);
    if (from !== to && doc.has(from)) {
      if (doc.has(to)) throw Error("Свойство «" + to + "» уже существует");
      const pair = doc.contents?.items.find((pair) => String(pair.key) === from);
      if (pair && isScalar(pair.key)) pair.key.value = to;
    }
  }
  for (const key of change.remove || []) {
    propertyName(key);
    doc.delete(key);
  }
  for (const [key, value] of Object.entries(change.set || {})) {
    propertyName(key);
    doc.set(key, value);
  }
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const body = match ? content.slice(match[0].length) : content;
  return doc.contents && (!isMap(doc.contents) || doc.contents.items.length)
    ? "---" +
        newline +
        doc.toString().trimEnd().replace(/\r?\n/g, newline) +
        newline +
        "---" +
        newline +
        body
    : body;
}
