import jsep from "jsep";
import { resolveLink } from "./markdown";
import type { FileEntry, NoteIndex } from "./types";

type Value = unknown;
type SyntaxNode = any;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const syntaxCache = new Map<string, SyntaxNode>();

/** Выражения Bases интерпретируются как данные. Код JavaScript не исполняется. */
export function evaluateExpression(
  source: string,
  variables: Record<string, Value>,
  formula?: (name: string) => Value,
): Value {
  if (typeof source !== "string" || source.length > 5000)
    throw Error("Слишком длинное выражение");
  let syntax = syntaxCache.get(source);
  if (!syntax) {
    syntax = jsep(source);
    if (syntaxCache.size > 500) syntaxCache.clear();
    syntaxCache.set(source, syntax);
  }
  let visited = 0;
  const bindings: Record<string, Value>[] = [];
  const get = (object: any, key: string): Value => {
    if (forbidden.has(key)) throw Error("Запрещённое свойство");
    if (object instanceof Date) {
      const fields: Record<string, number> = {
        year: object.getFullYear(),
        month: object.getMonth() + 1,
        day: object.getDate(),
        hour: object.getHours(),
        minute: object.getMinutes(),
        second: object.getSeconds(),
        millisecond: object.getMilliseconds(),
      };
      return fields[key];
    }
    if (key === "length" && (typeof object === "string" || Array.isArray(object)))
      return object.length;
    return object !== null && typeof object === "object" && Object.hasOwn(object, key)
      ? object[key]
      : null;
  };
  const call = (object: any, name: string, args: any[]): Value => {
    if (forbidden.has(name)) throw Error("Запрещённая функция");
    if (name === "isEmpty")
      return object == null || object === "" || (Array.isArray(object) && !object.length);
    if (name === "isTruthy") return !!object;
    if (name === "isType")
      return args[0] === "list"
        ? Array.isArray(object)
        : args[0] === "date"
          ? object instanceof Date
          : typeof object === args[0];
    if (name === "toString") return String(object ?? "");
    if (typeof object === "string") {
      if (name === "contains") return object.includes(String(args[0]));
      if (name === "containsAny") return args.some((a) => object.includes(String(a)));
      if (name === "containsAll") return args.every((a) => object.includes(String(a)));
      if (name === "startsWith") return object.startsWith(String(args[0]));
      if (name === "endsWith") return object.endsWith(String(args[0]));
      if (name === "lower" || name === "toLowerCase") return object.toLowerCase();
      if (name === "upper" || name === "toUpperCase") return object.toUpperCase();
      if (name === "trim") return object.trim();
      if (name === "slice")
        return object.slice(
          Number(args[0]),
          args[1] === undefined ? undefined : Number(args[1]),
        );
      if (name === "split") return object.split(String(args[0]));
      if (name === "replace") return object.replace(String(args[0]), String(args[1]));
      if (name === "replaceAll")
        return object.replaceAll(String(args[0]), String(args[1]));
    }
    if (typeof object === "number") {
      if (name === "toFixed")
        return object.toFixed(Math.max(0, Math.min(20, Number(args[0]) || 0)));
      if (name === "round") {
        const factor = 10 ** Math.max(-10, Math.min(10, Number(args[0]) || 0));
        return Math.round(object * factor) / factor;
      }
      if (name === "floor") return Math.floor(object);
      if (name === "ceil") return Math.ceil(object);
      if (name === "abs") return Math.abs(object);
    }
    if (Array.isArray(object)) {
      if (name === "contains") return object.includes(args[0]);
      if (name === "containsAny") return args.some((a) => object.includes(a));
      if (name === "containsAll") return args.every((a) => object.includes(a));
      if (name === "unique") return [...new Set(object)];
      if (name === "join") return object.join(args[0] ?? ", ");
      if (name === "reverse") return [...object].reverse();
      if (name === "sort") return [...object].sort();
      if (name === "slice")
        return object.slice(
          Number(args[0]),
          args[1] === undefined ? undefined : Number(args[1]),
        );
      if (name === "flat") return object.flat(1);
      const numbers = object.filter((v) => typeof v === "number");
      if (name === "sum") return numbers.reduce((a, b) => a + b, 0);
      if (name === "mean")
        return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
    }
    if (object instanceof Date) {
      if (name === "format") {
        const parts: Record<string, string> = {
          YYYY: String(object.getFullYear()),
          MM: String(object.getMonth() + 1).padStart(2, "0"),
          DD: String(object.getDate()).padStart(2, "0"),
          HH: String(object.getHours()).padStart(2, "0"),
          mm: String(object.getMinutes()).padStart(2, "0"),
          ss: String(object.getSeconds()).padStart(2, "0"),
        };
        return String(args[0] || "YYYY-MM-DD").replace(
          /YYYY|MM|DD|HH|mm|ss/g,
          (token) => parts[token],
        );
      }
      if (name === "date")
        return new Date(object.getFullYear(), object.getMonth(), object.getDate());
      if (name === "time") return object.toLocaleTimeString("ru-RU");
    }
    // Служебные функции создаёт только контекст строки, не YAML и не пользовательский код.
    if (object === variables.file && ["hasTag", "hasLink", "inFolder"].includes(name))
      return (object[name] as Function)(...args);
    throw Error("Неподдерживаемая функция: " + name);
  };
  const visit = (node: SyntaxNode, depth = 0): Value => {
    if (!node || depth > 48 || ++visited > 20000)
      throw Error("Слишком сложное выражение");
    const next = (child: SyntaxNode) => visit(child, depth + 1);
    if (node.type === "Literal") return node.value;
    if (node.type === "Identifier") {
      if (forbidden.has(node.name)) throw Error("Запрещённое имя");
      const local = bindings.findLast((scope) => Object.hasOwn(scope, node.name));
      if (local) return local[node.name];
      return Object.hasOwn(variables, node.name)
        ? variables[node.name]
        : get(variables.note, node.name);
    }
    if (node.type === "ArrayExpression") return node.elements.map(next);
    if (node.type === "MemberExpression") {
      const key = node.computed ? String(next(node.property)) : node.property.name;
      if (forbidden.has(key)) throw Error("Запрещённое свойство");
      if (node.object.type === "Identifier" && node.object.name === "formula")
        return formula?.(key) ?? null;
      return get(next(node.object), key);
    }
    if (node.type === "UnaryExpression") {
      const value = next(node.argument);
      if (node.operator === "!") return !value;
      if (node.operator === "-") return -Number(value);
      if (node.operator === "+") return Number(value);
      throw Error("Неподдерживаемый оператор");
    }
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      const left = next(node.left) as any;
      if (node.operator === "&&") return left && next(node.right);
      if (node.operator === "||") return left || next(node.right);
      if (node.operator === "??") return left ?? next(node.right);
      const right = next(node.right) as any;
      switch (node.operator) {
        case "==":
        case "===":
          return left instanceof Date || right instanceof Date
            ? Number(left) === Number(right)
            : left === right;
        case "!=":
        case "!==":
          return left !== right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case "+":
          return left instanceof Date && typeof right === "number"
            ? new Date(+left + right)
            : left + right;
        case "-":
          return Number(left) - Number(right);
        case "*":
          return Number(left) * Number(right);
        case "/":
          return Number(left) / Number(right);
        case "%":
          return Number(left) % Number(right);
        default:
          throw Error("Неподдерживаемый оператор");
      }
    }
    if (node.type === "CallExpression") {
      if (node.callee.type === "Identifier") {
        const name = node.callee.name;
        if (name === "if")
          return next(node.arguments[0])
            ? next(node.arguments[1])
            : node.arguments[2]
              ? next(node.arguments[2])
              : null;
        const args = node.arguments.map(next) as any[];
        if (name === "number") return Number(args[0]);
        if (name === "string") return String(args[0] ?? "");
        if (name === "list") return Array.isArray(args[0]) ? args[0] : [args[0]];
        if (name === "min") return Math.min(...args.map(Number));
        if (name === "max") return Math.max(...args.map(Number));
        if (name === "duration") {
          const match = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/.exec(String(args[0]));
          if (!match) throw Error("Длительность: число и ms, s, m, h, d или w");
          return (
            Number(match[1]) *
            { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2]]!
          );
        }
        if (name === "now") return new Date();
        if (name === "today") {
          const date = new Date();
          return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        }
        if (name === "date") {
          const date = new Date(args[0]);
          if (Number.isNaN(+date)) throw Error("Некорректная дата");
          return date;
        }
        if (name === "link" || name === "image" || name === "icon")
          return args[1] ?? args[0];
        throw Error("Неподдерживаемая функция: " + name);
      }
      if (node.callee.type === "MemberExpression") {
        const object = next(node.callee.object),
          name = node.callee.computed
            ? String(next(node.callee.property))
            : node.callee.property.name;
        if (Array.isArray(object) && ["map", "filter", "every", "some"].includes(name)) {
          if (object.length > 10000 || node.arguments.length !== 1)
            throw Error("Слишком сложная операция со списком");
          const evaluateItem = (value: unknown, index: number) => {
            bindings.push({ value, index });
            try {
              return next(node.arguments[0]);
            } finally {
              bindings.pop();
            }
          };
          if (name === "map") return object.map(evaluateItem);
          if (name === "filter") return object.filter(evaluateItem);
          if (name === "every") return object.every(evaluateItem);
          return object.some(evaluateItem);
        }
        return call(object, name, node.arguments.map(next));
      }
    }
    throw Error("Неподдерживаемый синтаксис Bases");
  };
  return visit(syntax);
}
export function matchesFilter(
  filter: unknown,
  evaluate: (expression: string) => Value,
  depth = 0,
): boolean {
  if (depth > 32) throw Error("Слишком глубокий фильтр");
  if (filter == null) return true;
  if (typeof filter === "string") return !!evaluate(filter);
  if (typeof filter !== "object" || Array.isArray(filter))
    throw Error("Некорректный фильтр");
  const data = filter as Record<string, unknown>;
  for (const key of ["and", "or", "not"])
    if (Object.hasOwn(data, key)) {
      if (!Array.isArray(data[key])) throw Error("Некорректный фильтр");
      const parts = data[key] as unknown[];
      if (key === "and") return parts.every((p) => matchesFilter(p, evaluate, depth + 1));
      if (key === "or") return parts.some((p) => matchesFilter(p, evaluate, depth + 1));
      return !parts.some((p) => matchesFilter(p, evaluate, depth + 1));
    }
  throw Error("Неподдерживаемый фильтр");
}
export function rowEvaluator(
  note: NoteIndex,
  file: FileEntry | undefined,
  index: NoteIndex[],
  formulas: Record<string, string> = {},
) {
  const folder = note.path.includes("/")
    ? note.path.slice(0, note.path.lastIndexOf("/"))
    : "";
  const variables: Record<string, Value> = {
    note: note.properties,
    file: {
      name: note.title,
      path: note.path,
      folder,
      ext: note.path.split(".").pop(),
      size: file?.size || 0,
      mtime: new Date(file?.modified || 0),
      tags: note.tags,
      links: note.links,
      hasTag: (tag: string) =>
        note.tags.some((t) => t === tag || t.startsWith(tag + "/")),
      inFolder: (value: string) => folder === value || folder.startsWith(value + "/"),
      hasLink: (target: string) =>
        note.links.some(
          (l) =>
            l === target ||
            resolveLink(
              l,
              note.path,
              index.map((n) => n.path),
              index,
            ) ===
              resolveLink(
                target,
                note.path,
                index.map((n) => n.path),
                index,
              ),
        ),
    },
  };
  const active = new Set<string>(),
    cache = new Map<string, Value>();
  const formula = (name: string): Value => {
    if (cache.has(name)) return cache.get(name);
    if (active.has(name)) throw Error("Цикл в формулах: " + name);
    if (!Object.hasOwn(formulas, name)) return null;
    active.add(name);
    try {
      const value = evaluateExpression(formulas[name], variables, formula);
      cache.set(name, value);
      return value;
    } finally {
      active.delete(name);
    }
  };
  const evaluate = (expression: string) =>
    evaluateExpression(expression, variables, formula);
  return {
    evaluate,
    get: (property: string): Value =>
      property === "tags"
        ? note.tags
        : property.startsWith("formula.")
          ? formula(property.slice(8))
          : property.startsWith("file.")
            ? evaluate(property)
            : note.properties[property.replace(/^note\./, "")],
  };
}
