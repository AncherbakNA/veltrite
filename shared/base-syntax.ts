import jsep from "jsep";
interface ParsedFormula {
  syntax: any;
  regexes: Map<string, RegExp>;
}
const cache = new Map<string, ParsedFormula>();
/** Regex literals are values, never executable code. Evaluation runs in the base worker. */
export function parseFormula(source: string): ParsedFormula {
  if (typeof source !== "string" || source.length > 5000)
    throw Error("Слишком длинная формула");
  const cached = cache.get(source);
  if (cached) return cached;
  const regexes = new Map<string, RegExp>();
  let rewritten = "",
    position = 0;
  while (position < source.length) {
    const char = source[position];
    if (char === '"' || char === "'" || char === "`") {
      const start = position++;
      while (position < source.length) {
        if (source[position] === "\\") position += 2;
        else if (source[position++] === char) break;
      }
      rewritten += source.slice(start, position);
      continue;
    }
    const previous = source.slice(0, position).trimEnd().at(-1);
    if (char !== "/" || (previous && !"([,:?=+-*/%!&|<>".includes(previous))) {
      rewritten += char;
      position++;
      continue;
    }
    const start = ++position;
    let characterClass = false,
      closed = false;
    while (position < source.length) {
      const current = source[position];
      if (current === "\n" || current === "\r")
        throw Error("Перенос строки внутри регулярного выражения");
      if (current === "\\") {
        position += 2;
        continue;
      }
      if (current === "[") characterClass = true;
      if (current === "]") characterClass = false;
      if (current === "/" && !characterClass) {
        closed = true;
        break;
      }
      position++;
    }
    if (!closed) throw Error("Закройте регулярное выражение символом /");
    const pattern = source.slice(start, position++),
      flagsStart = position;
    while (/[a-z]/i.test(source[position] || "")) position++;
    const flags = source.slice(flagsStart, position),
      name = "__veltriteRegex" + regexes.size;
    if (pattern.length > 2000 || !/^[dgimsuvy]*$/.test(flags))
      throw Error("Некорректные флаги регулярного выражения");
    try {
      regexes.set(name, new RegExp(pattern, flags));
    } catch {
      throw Error("Некорректное регулярное выражение");
    }
    rewritten += name;
  }
  let syntax: any;
  try {
    syntax = jsep(rewritten);
  } catch (error: any) {
    throw Error("Некорректная формула: " + error.message);
  }
  const result = { syntax, regexes };
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(source, result);
  return result;
}
