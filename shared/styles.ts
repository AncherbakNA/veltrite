export interface StyleDefinition {
  id: string;
  name: string;
  kind: "theme" | "snippet";
  css: string;
}
export function validateCss(css: string): string {
  if (typeof css !== "string" || css.length > 1024 * 1024 || css.includes("\0"))
    throw Error("CSS должен быть не больше 1 МиБ");
  // CSP also blocks remote requests. Imports cannot silently add unreviewed sheets.
  if (
    /@import\b/i.test(css) ||
    /(?:expression\s*\(|javascript\s*:|-moz-binding\s*:)/i.test(css)
  )
    throw Error("Удалите @import и исполняемые выражения из CSS");
  return css;
}
export function styleId(id: string): string {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw Error("Некорректный идентификатор стиля");
  return id;
}
