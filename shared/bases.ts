import { globalBaseFunction, memberBaseFunction } from "./base-functions";
import { parseFormula } from "./base-syntax";
import {
  BaseDuration,
  BaseFile,
  createBaseEnvironment,
  durationValue,
  equalValues,
  offsetDate,
  valueString,
  type BaseEnvironment,
} from "./base-values";
import type { FileEntry, NoteIndex } from "./types";

type Value = unknown;
type SyntaxNode = any;
const forbidden = new Set(["__proto__", "constructor", "prototype"]);

/** Выражения Bases интерпретируются как данные. Код JavaScript не исполняется. */
export function evaluateExpression(
  source: string,
  variables: Record<string, Value>,
  formula?: (name: string) => Value,
  environment?: BaseEnvironment,
): Value {
  if (typeof source !== "string" || source.length > 5000)
    throw Error("Слишком длинное выражение");
  const { syntax, regexes } = parseFormula(source);
  let visited = 0;
  const bindings: Record<string, Value>[] = [];
  const get = (object: any, key: string): Value => {
    if (forbidden.has(key)) throw Error("Запрещённое свойство");
    if (object instanceof BaseFile && key === "file") return object;
    if (object instanceof BaseFile && key === "backlinks")
      return environment?.backlinks(object) || [];
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
    return memberBaseFunction(object, name, args, environment);
  };
  const visit = (node: SyntaxNode, depth = 0): Value => {
    if (!node || depth > 48 || ++visited > 200000)
      throw Error("Слишком сложное выражение");
    const next = (child: SyntaxNode) => visit(child, depth + 1);
    if (node.type === "Literal") return node.value;
    if (node.type === "ThisExpression") return variables.this || null;
    if (node.type === "Identifier") {
      if (forbidden.has(node.name)) throw Error("Запрещённое имя");
      if (regexes.has(node.name)) return regexes.get(node.name);
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
      if (node.operator === "-")
        return value instanceof BaseDuration ? value.scale(-1) : -Number(value);
      if (node.operator === "+") return Number(value);
      throw Error("Неподдерживаемый оператор");
    }
    if (node.type === "ConditionalExpression")
      return next(node.test) ? next(node.consequent) : next(node.alternate);
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
      const left = next(node.left) as any;
      if (node.operator === "&&") return left && next(node.right);
      if (node.operator === "||") return left || next(node.right);
      if (node.operator === "??") return left ?? next(node.right);
      const right = next(node.right) as any;
      switch (node.operator) {
        case "==":
        case "===":
          return equalValues(left, right);
        case "!=":
        case "!==":
          return !equalValues(left, right);
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case "+":
          if (left instanceof Date) return offsetDate(left, durationValue(right));
          if (left instanceof BaseDuration) {
            const value = durationValue(right);
            return new BaseDuration(
              left.milliseconds + value.milliseconds,
              left.months + value.months,
            );
          }
          if (typeof left === "string" || typeof right === "string") {
            const a = valueString(left),
              b = valueString(right);
            if (a.length + b.length > 1024 * 1024)
              throw Error("Результат формулы больше 1 МиБ");
            return a + b;
          }
          return left + right;
        case "-":
          if (left instanceof Date && right instanceof Date)
            return new BaseDuration(+left - +right);
          if (left instanceof Date)
            return offsetDate(left, durationValue(right).scale(-1));
          if (left instanceof BaseDuration) {
            const value = durationValue(right);
            return new BaseDuration(
              left.milliseconds - value.milliseconds,
              left.months - value.months,
            );
          }
          return Number(left) - Number(right);
        case "*":
          if (left instanceof BaseDuration) return left.scale(Number(right));
          if (right instanceof BaseDuration)
            throw Error("В умножении длительность должна стоять слева");
          return Number(left) * Number(right);
        case "/":
          return left instanceof BaseDuration
            ? left.scale(1 / Number(right))
            : Number(left) / Number(right);
        case "**":
          return Number(left) ** Number(right);
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
        return globalBaseFunction(name, node.arguments.map(next), environment);
      }
      if (node.callee.type === "MemberExpression") {
        const object = next(node.callee.object),
          name = node.callee.computed
            ? String(next(node.callee.property))
            : node.callee.property.name;
        if (
          Array.isArray(object) &&
          ["map", "filter", "every", "some", "reduce"].includes(name)
        ) {
          if (
            object.length > 10000 ||
            node.arguments.length !== (name === "reduce" ? 2 : 1)
          )
            throw Error("Слишком сложная операция со списком");
          let accumulator = name === "reduce" ? next(node.arguments[1]) : undefined;
          const evaluateItem = (value: unknown, index: number) => {
            bindings.push({ value, index, acc: accumulator });
            try {
              return next(node.arguments[0]);
            } finally {
              bindings.pop();
            }
          };
          if (name === "reduce") {
            for (let i = 0; i < object.length; i++)
              accumulator = evaluateItem(object[i], i);
            return accumulator;
          }
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
  options: {
    environment?: BaseEnvironment;
    thisPath?: string;
    types?: Record<string, string>;
    account?: (name: string, value: unknown) => void;
  } = {},
) {
  const shared =
    options.environment ||
    createBaseEnvironment(index, file ? [file] : [], note.path, options.types);
  const environment = { ...shared, source: note.path };
  const current = shared.file(note.path, "")!;
  const thisFile = shared.file(options.thisPath || note.path, "");
  const variables: Record<string, Value> = {
    note: current?.properties || note.properties,
    file: current,
    this: { ...(thisFile?.properties || {}), file: thisFile },
  };
  const active = new Set<string>(),
    cache = new Map<string, Value>();
  const formula = (name: string): Value => {
    if (cache.has(name)) return cache.get(name);
    if (active.has(name)) throw Error("Цикл в формулах: " + name);
    if (active.size >= 48) throw Error("Слишком глубокая зависимость формул");
    if (!Object.hasOwn(formulas, name)) return null;
    active.add(name);
    try {
      const value = evaluateExpression(formulas[name], variables, formula, environment);
      options.account?.("formula." + name, value);
      cache.set(name, value);
      return value;
    } finally {
      active.delete(name);
    }
  };
  const evaluate = (expression: string) =>
    evaluateExpression(expression, variables, formula, environment);
  return {
    evaluate,
    get: (property: string): Value =>
      property === "tags"
        ? note.tags
        : property.startsWith("formula.")
          ? formula(property.slice(8))
          : property.startsWith("file.")
            ? evaluate(property)
            : (current?.properties || note.properties)[property.replace(/^note\./, "")],
  };
}
