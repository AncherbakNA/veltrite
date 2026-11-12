import {
  BaseDuration,
  BaseFile,
  BaseHtml,
  BaseIcon,
  BaseImage,
  BaseLink,
  durationValue,
  emptyValue,
  equalValues,
  parseBaseDate,
  valueKey,
  valueString,
  valueType,
  type BaseEnvironment,
} from "./base-values";
import { formatDate } from "./templates";
const MAX_TEXT = 1024 * 1024;
function bounded(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_TEXT)
    throw Error("Результат формулы больше 1 МиБ");
  if (Array.isArray(value) && value.length > 10000)
    throw Error("Результат формулы содержит больше 10 000 элементов");
  return value;
}
function replaceText(
  source: string,
  pattern: string | RegExp,
  replacement: string,
): string {
  let projected = source.length;
  if (typeof pattern === "string") {
    const count = pattern ? source.split(pattern).length - 1 : source.length + 1;
    if (source.length + count * (replacement.length - pattern.length) > MAX_TEXT)
      throw Error("Результат замены больше 1 МиБ");
    return source.replaceAll(pattern, replacement);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, (...parts: any[]) => {
    const groups = typeof parts.at(-1) === "object" ? parts.pop() : undefined;
    parts.pop();
    const offset = parts.pop() as number,
      match = parts[0] as string,
      captures = parts.slice(1);
    const text = replacement.replace(
      /\$\$|\$&|\$`|\$'|\$<(\w+)>|\$(\d{1,2})/g,
      (token, group, number) => {
        if (token === "$$") return "$";
        if (token === "$&") return match;
        if (token === "$`") return source.slice(0, offset);
        if (token === "$'") return source.slice(offset + match.length);
        if (group) return groups?.[group] ?? "";
        const index = Number(number);
        return index > 0 && index <= captures.length ? captures[index - 1] || "" : token;
      },
    );
    projected += text.length - match.length;
    if (projected > MAX_TEXT) throw Error("Результат замены больше 1 МиБ");
    return text;
  });
}
export function globalBaseFunction(
  name: string,
  args: any[],
  environment?: BaseEnvironment,
): unknown {
  let result: unknown;
  switch (name) {
    case "number": {
      const number = Number(args[0] instanceof BaseDuration ? +args[0] : args[0]);
      if (!Number.isFinite(number)) throw Error("Значение не является конечным числом");
      return number;
    }
    case "string":
      return valueString(args[0]);
    case "list":
      return Array.isArray(args[0]) ? args[0] : [args[0]];
    case "min":
      return Math.min(...args.map(Number));
    case "max":
      return Math.max(...args.map(Number));
    case "duration":
      return durationValue(args[0]);
    case "random":
      return Math.random();
    case "now":
      return new Date();
    case "today": {
      const date = new Date();
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    case "date":
      return parseBaseDate(args[0]);
    case "file":
      return args[0] == null
        ? null
        : environment?.file(args[0], environment.source) || null;
    case "link":
      return (
        environment?.link(args[0], args[1], environment.source) ||
        new BaseLink(valueString(args[0]), args[1] ?? valueString(args[0]), "")
      );
    case "image": {
      const value = args[0];
      return new BaseImage(
        value instanceof BaseFile
          ? value.path
          : value instanceof BaseLink
            ? value.resolved || value.path
            : environment?.file(value, environment.source)?.path || valueString(value),
      );
    }
    case "icon": {
      const name = valueString(args[0]);
      if (!/^[\w-]{1,100}$/.test(name)) throw Error("Некорректное имя иконки");
      return new BaseIcon(name);
    }
    case "html":
      result = new BaseHtml(valueString(args[0]));
      break;
    case "escapeHTML":
      result = valueString(args[0]).replace(
        /[&<>"']/g,
        (char) =>
          ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
            char
          ]!,
      );
      break;
    default:
      throw Error("Неподдерживаемая функция: " + name);
  }
  return bounded(result);
}
export function memberBaseFunction(
  object: any,
  name: string,
  args: any[],
  environment?: BaseEnvironment,
): unknown {
  if (name === "isEmpty") return emptyValue(object);
  if (name === "isTruthy") return !!object;
  if (name === "isType") return valueType(object) === args[0];
  if (name === "toString") return valueString(object);
  if (object instanceof BaseLink) {
    if (object.kind === "url")
      return memberBaseFunction(object.path, name, args, environment);
    if (name === "asFile") return environment?.file(object, object.source) || null;
    if (name === "linksTo") {
      const file = environment?.file(object, object.source);
      return file ? memberBaseFunction(file, "hasLink", args, environment) : false;
    }
  }
  if (object instanceof BaseFile) {
    if (name === "asLink")
      return new BaseLink(object.path, args[0] ?? object.basename, "", object.path);
    if (name === "hasProperty") return Object.hasOwn(object.properties, String(args[0]));
    if (name === "hasTag")
      return args.some((value) => {
        const tag = String(value).replace(/^#/, "");
        return object.tags.some((entry) => entry === tag || entry.startsWith(tag + "/"));
      });
    if (name === "inFolder") {
      const folder = String(args[0]).replace(/^\/+|\/+$/g, "");
      return (
        !folder || object.folder === folder || object.folder.startsWith(folder + "/")
      );
    }
    if (name === "hasLink") {
      const target = environment?.file(args[0], object.path);
      return object.links.some((link) =>
        target ? equalValues(link, target) : link.path === valueString(args[0]),
      );
    }
  }
  if (object instanceof RegExp && name === "matches") {
    object.lastIndex = 0;
    return object.test(valueString(args[0]));
  }
  if (typeof object === "string") {
    let result: unknown;
    switch (name) {
      case "contains":
        return object.includes(valueString(args[0]));
      case "containsAny":
        return args.some((value) => object.includes(valueString(value)));
      case "containsAll":
        return args.every((value) => object.includes(valueString(value)));
      case "startsWith":
        return object.startsWith(valueString(args[0]));
      case "endsWith":
        return object.endsWith(valueString(args[0]));
      case "lower":
      case "toLowerCase":
        return object.toLocaleLowerCase();
      case "upper":
      case "toUpperCase":
        return object.toLocaleUpperCase();
      case "title":
        return object.replace(
          /\p{L}[\p{L}\p{M}]*/gu,
          (word) => word[0].toLocaleUpperCase() + word.slice(1).toLocaleLowerCase(),
        );
      case "trim":
        return object.trim();
      case "reverse":
        return [...object].reverse().join("");
      case "slice":
        return object.slice(
          Number(args[0]),
          args[1] === undefined ? undefined : Number(args[1]),
        );
      case "split":
        result = object.split(
          args[0] instanceof RegExp ? args[0] : valueString(args[0]),
          args[1] === undefined ? undefined : Number(args[1]),
        );
        break;
      case "repeat": {
        const count = Math.floor(Number(args[0]));
        if (!Number.isFinite(count) || count < 0 || object.length * count > MAX_TEXT)
          throw Error("Слишком большое повторение строки");
        return object.repeat(count);
      }
      case "replace":
      case "replaceAll":
        return bounded(
          replaceText(
            object,
            args[0] instanceof RegExp ? args[0] : valueString(args[0]),
            valueString(args[1]),
          ),
        );
      default:
        throw Error("Неподдерживаемая функция: " + name);
    }
    return bounded(result);
  }
  if (typeof object === "number") {
    if (name === "abs") return Math.abs(object);
    if (name === "floor") return Math.floor(object);
    if (name === "ceil") return Math.ceil(object);
    if (name === "round") {
      const factor = 10 ** Math.max(-15, Math.min(15, Number(args[0]) || 0));
      return Math.round(object * factor) / factor;
    }
    if (name === "toFixed")
      return object.toFixed(Math.max(0, Math.min(100, Number(args[0]) || 0)));
  }
  if (object instanceof Date) {
    if (name === "date")
      return new Date(object.getFullYear(), object.getMonth(), object.getDate());
    if (name === "format") return formatDate(object, String(args[0] || "YYYY-MM-DD"));
    if (name === "time") return formatDate(object, "HH:mm:ss");
    if (name === "relative") {
      const seconds = (+object - Date.now()) / 1000,
        unit: Intl.RelativeTimeFormatUnit =
          Math.abs(seconds) < 60
            ? "second"
            : Math.abs(seconds) < 3600
              ? "minute"
              : Math.abs(seconds) < 86400
                ? "hour"
                : Math.abs(seconds) < 2592000
                  ? "day"
                  : Math.abs(seconds) < 31536000
                    ? "month"
                    : "year";
      const divisor = {
        second: 1,
        minute: 60,
        hour: 3600,
        day: 86400,
        month: 2592000,
        year: 31536000,
      }[unit as "second"];
      return new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(
        Math.round(seconds / divisor),
        unit,
      );
    }
  }
  if (Array.isArray(object)) {
    if (name === "contains") return object.some((value) => equalValues(value, args[0]));
    if (name === "containsAny")
      return args.some((value) => object.some((entry) => equalValues(value, entry)));
    if (name === "containsAll")
      return args.every((value) => object.some((entry) => equalValues(value, entry)));
    if (name === "unique") {
      const seen = new Set<string>(),
        result: unknown[] = [];
      let bytes = 0;
      for (const value of object) {
        const key = valueKey(value);
        if (!seen.has(key)) {
          bytes += key.length * 2;
          if (bytes > 4 * 1024 * 1024)
            throw Error("Слишком большой список уникальных значений");
          seen.add(key);
          result.push(value);
        }
      }
      return result;
    }
    if (name === "join") return bounded(object.map(valueString).join(args[0] ?? ", "));
    if (name === "reverse") return [...object].reverse();
    if (name === "sort")
      return [...object].sort((a, b) =>
        typeof a === "number" && typeof b === "number"
          ? a - b
          : a instanceof Date && b instanceof Date
            ? +a - +b
            : valueString(a).localeCompare(valueString(b), "ru"),
      );
    if (name === "slice")
      return object.slice(
        Number(args[0]),
        args[1] === undefined ? undefined : Number(args[1]),
      );
    if (name === "flat") return bounded(object.flat(1));
    const numbers = object.filter(
      (value) => typeof value === "number" && Number.isFinite(value),
    );
    if (name === "sum") return numbers.reduce((sum, value) => sum + value, 0);
    if (name === "mean")
      return numbers.length
        ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
        : 0;
  }
  if (
    object &&
    typeof object === "object" &&
    (Object.getPrototypeOf(object) === Object.prototype ||
      Object.getPrototypeOf(object) === null)
  ) {
    if (name === "keys") return Object.keys(object);
    if (name === "values") return Object.values(object);
  }
  throw Error("Неподдерживаемая функция: " + name);
}
