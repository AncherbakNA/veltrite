import { searchRanges, type SearchScope } from "./markdown-ranges";
import type { NoteIndex, SearchResult } from "./types";
export interface SearchDocument {
  note: NoteIndex;
  text: string;
}
type Matcher = {
  field: string;
  value: string;
  regex?: { source: string; flags: string };
  property?: string;
};
export type SearchExpression =
  | { op: "term"; match: Matcher }
  | { op: "not"; child: SearchExpression }
  | { op: "scope"; scope: SearchScope; child: SearchExpression }
  | { op: "and" | "or"; left: SearchExpression; right: SearchExpression };
/** A small query language; expressions are data and never evaluated as JavaScript. */
export function parseSearch(query: string): SearchExpression | null {
  if (typeof query !== "string" || query.length > 500)
    throw Error("Запрос должен быть короче 500 символов");
  const tokens: string[] = [];
  let position = 0;
  while (position < query.length) {
    if (/\s/.test(query[position])) {
      position++;
      continue;
    }
    if ("()-".includes(query[position])) {
      tokens.push(query[position++]);
      continue;
    }
    const start = position;
    let quoted = false,
      regex = false,
      bracket = false;
    for (; position < query.length; position++) {
      const c = query[position];
      if (c === "\\") {
        position++;
        continue;
      }
      if (!regex && c === '"') quoted = !quoted;
      if (
        !quoted &&
        c === "/" &&
        (regex || position === start || query[position - 1] === ":")
      )
        regex = !regex;
      if (!quoted && !regex && c === "[") bracket = true;
      if (!quoted && !regex && c === "]") bracket = false;
      if (!quoted && !regex && !bracket && ("()".includes(c) || /\s/.test(c))) break;
    }
    if (quoted || regex || bracket)
      throw Error("Закройте кавычки, скобки или регулярное выражение");
    tokens.push(query.slice(start, position));
  }
  let cursor = 0;
  function term(): SearchExpression {
    const token = tokens[cursor++];
    if (!token) throw Error("После оператора нужно условие");
    if (token === "-" || token.toUpperCase() === "NOT")
      return { op: "not", child: term() };
    if (token === "(") {
      const expression = or();
      if (tokens[cursor++] !== ")") throw Error("Закройте группу круглой скобкой");
      return expression;
    }
    if ([")", "AND", "OR"].includes(token.toUpperCase()))
      throw Error("Ожидалось условие поиска");
    const scoped = /^(line|block|section|task|task-todo|task-done):(.*)$/i.exec(token);
    if (scoped) {
      if (scoped[2]) tokens.splice(cursor, 0, scoped[2]);
      return {
        op: "scope",
        scope: scoped[1].toLowerCase() as SearchScope,
        child: term(),
      };
    }
    let field = "text",
      value = token,
      property: string | undefined;
    if (token.startsWith("[")) {
      const inside = token.slice(1, -1),
        colon = inside.indexOf(":");
      property = (colon < 0 ? inside : inside.slice(0, colon)).trim();
      value = colon < 0 ? "" : inside.slice(colon + 1).trim();
      field = "property";
      if (!property) throw Error("Укажите имя свойства");
    } else {
      const match = /^(path|file|tag|content|title):(.+)$/i.exec(token);
      if (match) {
        field = match[1].toLowerCase();
        value = match[2];
      }
    }
    if (value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    const match: Matcher = { field, value, property };
    if (value.startsWith("/")) {
      const end = value.lastIndexOf("/");
      if (
        end <= 0 ||
        !/^[imu]*$/.test(value.slice(end + 1)) ||
        new Set(value.slice(end + 1)).size !== value.slice(end + 1).length
      )
        throw Error("Допустимы флаги регулярного выражения i, m, u");
      match.regex = { source: value.slice(1, end), flags: value.slice(end + 1) };
      try {
        new RegExp(match.regex.source, match.regex.flags);
      } catch {
        throw Error("Некорректное регулярное выражение");
      }
    }
    return { op: "term", match };
  }
  function and(): SearchExpression {
    let left = term();
    while (
      cursor < tokens.length &&
      tokens[cursor] !== ")" &&
      tokens[cursor].toUpperCase() !== "OR"
    ) {
      if (tokens[cursor].toUpperCase() === "AND") cursor++;
      left = { op: "and", left, right: term() };
    }
    return left;
  }
  function or(): SearchExpression {
    let left = and();
    while (tokens[cursor]?.toUpperCase() === "OR") {
      cursor++;
      left = { op: "or", left, right: and() };
    }
    return left;
  }
  if (!tokens.length) return null;
  const expression = or();
  if (cursor !== tokens.length) throw Error("Лишняя закрывающая скобка");
  return expression;
}
function compile(match: Matcher): (document: SearchDocument) => boolean {
  const regex = match.regex ? new RegExp(match.regex.source, match.regex.flags) : null;
  const lower = match.value.toLocaleLowerCase();
  const test = (value: unknown) =>
    regex
      ? regex.test(String(value ?? ""))
      : String(value ?? "")
          .toLocaleLowerCase()
          .includes(lower);
  switch (match.field) {
    case "path":
      return (d) => test(d.note.path);
    case "file":
      return (d) => test(d.note.path.split("/").pop());
    case "title":
      return (d) => test(d.note.title) || d.note.aliases.some(test);
    case "content":
      return (d) => test(d.text);
    case "tag": {
      const tag = lower.replace(/^#/, "");
      return (d) =>
        d.note.tags.some((t) =>
          regex
            ? test(t)
            : t.toLocaleLowerCase() === tag ||
              t.toLocaleLowerCase().startsWith(tag + "/"),
        );
    }
    case "property":
      return (d) => {
        const value = d.note.properties[match.property!];
        if (value === undefined) return false;
        if (!match.value) return true;
        const comparison = /^(>=|<=|!=|>|<|=)\s*(.*)$/.exec(match.value);
        if (comparison) {
          const expected = comparison[2],
            actual = Array.isArray(value) ? value.join(", ") : value;
          if ([">", "<", ">=", "<="].includes(comparison[1])) {
            const a = Number(actual),
              b = Number(expected);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
            return comparison[1] === ">"
              ? a > b
              : comparison[1] === "<"
                ? a < b
                : comparison[1] === ">="
                  ? a >= b
                  : a <= b;
          }
          const equal =
            String(actual).toLocaleLowerCase() === expected.toLocaleLowerCase();
          return comparison[1] === "!=" ? !equal : equal;
        }
        return Array.isArray(value) ? value.some(test) : test(value);
      };
    default:
      return (d) => test(d.text) || test(d.note.path);
  }
}
function predicate(expression: SearchExpression): (d: SearchDocument) => boolean {
  if (expression.op === "term") return compile(expression.match);
  if (expression.op === "scope") {
    const matches = predicate(expression.child);
    return (document) =>
      searchRanges(document.text, expression.scope).some((range) =>
        matches({ ...document, text: document.text.slice(range.from, range.to) }),
      );
  }
  if (expression.op === "not") {
    const child = predicate(expression.child);
    return (d) => !child(d);
  }
  const left = predicate(expression.left),
    right = predicate(expression.right);
  return expression.op === "and"
    ? (d) => left(d) && right(d)
    : (d) => left(d) || right(d);
}
/** This function runs inside a disposable worker, including every regular expression. */
export function searchDocuments(
  documents: SearchDocument[],
  expression: SearchExpression,
): SearchResult[] {
  const matches = predicate(expression),
    results: SearchResult[] = [];
  const positives: ((d: SearchDocument) => boolean)[] = [];
  const scopes: Extract<SearchExpression, { op: "scope" }>[] = [];
  function collect(node: SearchExpression) {
    if (node.op === "scope") scopes.push(node);
    else if (node.op === "term" && ["text", "content"].includes(node.match.field))
      positives.push(compile({ ...node.match, field: "content" }));
    else if (node.op === "and" || node.op === "or") {
      collect(node.left);
      collect(node.right);
    }
  }
  collect(expression);
  for (const document of documents) {
    if (!matches(document)) continue;
    const lines = document.text.split("\n");
    let count = 0;
    for (const scope of scopes) {
      const matches = predicate(scope.child);
      for (const range of searchRanges(document.text, scope.scope)) {
        const text = document.text.slice(range.from, range.to);
        if (matches({ ...document, text })) {
          results.push({
            path: document.note.path,
            line: range.line,
            text: text.replace(/\r?\n/g, " ").slice(0, 250),
          });
          if (++count >= 5 || results.length >= 500) break;
        }
      }
      if (count >= 5 || results.length >= 500) break;
    }
    if (!count && positives.length)
      for (let i = 0; i < lines.length; i++) {
        if (positives.some((test) => test({ ...document, text: lines[i] }))) {
          results.push({
            path: document.note.path,
            line: i + 1,
            text: lines[i].slice(0, 250),
          });
          if (++count === 5 || results.length === 500) break;
        }
      }
    if (!count) {
      const line = document.note.headings[0]?.line || 1;
      results.push({
        path: document.note.path,
        line,
        text: (lines[line - 1] || "").slice(0, 250),
      });
    }
    if (results.length >= 500) break;
  }
  return results;
}

/** Metadata predicates for the graph worker; regexes stay inside disposable workers. */
export function metadataPredicate(
  query: string,
): (note: import("./types").NoteIndex) => boolean {
  const expression = parseSearch(query);
  if (!expression) return () => true;
  const test = predicate(expression);
  return (note) =>
    test({
      note,
      text: note.title + " " + note.aliases.join(" ") + " " + note.tags.join(" "),
    });
}
