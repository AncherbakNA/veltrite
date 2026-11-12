import { linkResolver } from "./graph";
import type { FileEntry, NoteIndex } from "./types";

export class BaseLink {
  readonly kind: "link" | "url";
  constructor(
    readonly path: string,
    readonly display: unknown,
    readonly source: string,
    readonly resolved: string | null = null,
  ) {
    this.kind = /^https?:\/\//i.test(path) ? "url" : "link";
  }
  toString() {
    return this.kind === "url" ? this.path : "[[" + this.path + "]]";
  }
}
export class BaseImage {
  readonly kind = "image";
  constructor(readonly path: string) {}
}
export class BaseIcon {
  readonly kind = "icon";
  constructor(readonly name: string) {}
}
export class BaseHtml {
  readonly kind = "html";
  constructor(readonly html: string) {}
}
export class BaseDuration {
  constructor(
    readonly milliseconds: number,
    readonly months = 0,
  ) {}
  valueOf() {
    return this.milliseconds + this.months * 30 * 86400000;
  }
  scale(factor: number) {
    return new BaseDuration(this.milliseconds * factor, this.months * factor);
  }
  toString() {
    return this.months
      ? this.months + "M " + this.milliseconds + "ms"
      : this.milliseconds + "ms";
  }
}
export class BaseFile {
  readonly path: string;
  readonly name: string;
  readonly basename: string;
  readonly folder: string;
  readonly ext: string;
  readonly size: number;
  readonly ctime: Date;
  readonly mtime: Date;
  readonly tags: string[];
  readonly properties: Record<string, unknown>;
  readonly links: BaseLink[];
  readonly embeds: BaseLink[];
  constructor(
    note: NoteIndex,
    file: FileEntry | undefined,
    properties: Record<string, unknown>,
    links: BaseLink[],
    embeds: BaseLink[],
  ) {
    this.path = note.path;
    this.name = note.path.split("/").pop()!;
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.folder = note.path.split("/").slice(0, -1).join("/");
    this.ext = this.name.includes(".") ? this.name.split(".").pop()! : "";
    this.size = file?.size || 0;
    this.ctime = new Date(file?.created || file?.modified || 0);
    this.mtime = new Date(file?.modified || 0);
    this.tags = note.tags;
    this.properties = properties;
    this.links = links;
    this.embeds = embeds;
  }
  toString() {
    return this.path;
  }
}
export interface BaseEnvironment {
  source: string;
  file(path: unknown, from?: string): BaseFile | null;
  link(path: unknown, display?: unknown, from?: string): BaseLink;
  backlinks(file: BaseFile): BaseFile[];
}
export function emptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (
    value instanceof Date ||
    value instanceof BaseDuration ||
    value instanceof BaseLink ||
    value instanceof BaseFile
  )
    return false;
  return typeof value === "object" && Object.keys(value).length === 0;
}
export function valueType(value: unknown): string {
  if (value == null) return "null";
  if (value instanceof Date) return "date";
  if (value instanceof BaseDuration) return "duration";
  if (value instanceof BaseLink) return value.kind;
  if (value instanceof BaseFile) return "file";
  if (value instanceof RegExp) return "regexp";
  if (Array.isArray(value)) return "list";
  return typeof value;
}
export function valueString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof BaseImage) return value.path;
  if (value instanceof BaseIcon) return value.name;
  if (value instanceof BaseHtml) return value.html;
  if (Array.isArray(value)) return value.map(valueString).join(", ");
  if (
    typeof value === "object" &&
    !(value instanceof BaseLink) &&
    !(value instanceof BaseFile) &&
    !(value instanceof BaseDuration) &&
    !(value instanceof RegExp)
  )
    return JSON.stringify(value);
  return String(value);
}
export function equalValues(left: any, right: any): boolean {
  if (
    left &&
    typeof left === "object" &&
    Object.hasOwn(left, "file") &&
    left.file instanceof BaseFile
  )
    left = left.file;
  if (
    right &&
    typeof right === "object" &&
    Object.hasOwn(right, "file") &&
    right.file instanceof BaseFile
  )
    right = right.file;
  const path = (value: unknown) =>
    value instanceof BaseFile
      ? value.path
      : value instanceof BaseLink
        ? value.resolved || value.path
        : null;
  if (path(left) !== null || path(right) !== null)
    return path(left) !== null && path(left) === path(right);
  if (left instanceof Date && right instanceof Date) return +left === +right;
  if (left instanceof BaseDuration && right instanceof BaseDuration)
    return left.milliseconds === right.milliseconds && left.months === right.months;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, i) => equalValues(value, right[i]))
    );
  if (left && right && typeof left === "object" && typeof right === "object")
    return valueKey(left) === valueKey(right);
  return left === right;
}
export function valueKey(value: any, depth = 0): string {
  if (depth > 20) throw Error("Слишком глубокое сравнение значений");
  if (value instanceof BaseFile) return "file:" + value.path;
  if (value instanceof BaseLink)
    return value.resolved ? "file:" + value.resolved : value.kind + ":" + value.path;
  if (value instanceof Date) return "date:" + +value;
  if (value instanceof BaseDuration)
    return "duration:" + value.months + ":" + value.milliseconds;
  if (value instanceof BaseImage) return "image:" + value.path;
  if (value instanceof BaseHtml) return "html:" + value.html;
  if (value instanceof BaseIcon) return "icon:" + value.name;
  if (value && typeof value === "object") {
    let result = Array.isArray(value) ? "list:" : "object:";
    for (const [key, item] of Object.entries(value).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const part = key + "=" + valueKey(item, depth + 1) + ";";
      if (result.length + part.length > 4 * 1024 * 1024)
        throw Error("Слишком большое сравнение значений");
      result += part;
    }
    return result;
  }
  return typeof value + ":" + String(value);
}
export function durationValue(input: unknown): BaseDuration {
  if (input instanceof BaseDuration) return input;
  if (typeof input === "number" && Number.isFinite(input)) return new BaseDuration(input);
  const text = String(input).trim();
  let milliseconds = 0,
    months = 0,
    offset = 0;
  const pattern =
    /([+-]?\d+(?:\.\d+)?)\s*(milliseconds?|minutes?|seconds?|months?|years?|weeks?|hours?|days?|ms|[yMwdhms])/g;
  for (const match of text.matchAll(pattern)) {
    if (text.slice(offset, match.index).trim()) throw Error("Некорректная длительность");
    const number = Number(match[1]),
      unit = match[2];
    if (unit === "M" || unit.startsWith("month")) months += number;
    else if (unit === "y" || unit.startsWith("year")) months += number * 12;
    else {
      const multiplier =
        unit === "ms" || unit.startsWith("millisecond")
          ? 1
          : unit === "s" || unit.startsWith("second")
            ? 1000
            : unit === "m" || unit.startsWith("minute")
              ? 60000
              : unit === "h" || unit.startsWith("hour")
                ? 3600000
                : unit === "w" || unit.startsWith("week")
                  ? 604800000
                  : 86400000;
      milliseconds += number * multiplier;
    }
    offset = match.index! + match[0].length;
  }
  if (
    !offset ||
    text.slice(offset).trim() ||
    !Number.isFinite(milliseconds) ||
    !Number.isFinite(months)
  )
    throw Error("Длительность: число и единица времени, например 2d или 1 month");
  return new BaseDuration(milliseconds, months);
}
/** A date without a timezone is a local calendar date, matching today() and date properties. */
export function parseBaseDate(value: unknown): Date {
  if (value instanceof Date) return new Date(+value);
  const calendar =
    typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (calendar) {
    const year = Number(calendar[1]),
      month = Number(calendar[2]),
      day = Number(calendar[3]),
      date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    )
      throw Error("Некорректная дата");
    return date;
  }
  const date =
    typeof value === "number"
      ? new Date(value)
      : typeof value === "string"
        ? new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:)/, "$1T$2"))
        : new Date(NaN);
  if (!Number.isFinite(+date)) throw Error("Некорректная дата");
  return date;
}
export function offsetDate(date: Date, duration: BaseDuration): Date {
  const result = new Date(+date);
  if (duration.months) {
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + duration.months);
    const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, last));
  }
  result.setTime(+result + duration.milliseconds);
  return result;
}

export function createBaseEnvironment(
  index: NoteIndex[],
  files: FileEntry[],
  source: string,
  types: Record<string, string> = {},
): BaseEnvironment {
  const known = new Map(index.map((note) => [note.path, note])),
    entries = new Map(files.map((file) => [file.path, file]));
  const paths = [...new Set([...known.keys(), ...entries.keys()])],
    resolve = linkResolver(paths, index),
    cache = new Map<string, BaseFile>(),
    incoming = new Map<string, string[]>();
  for (const note of index)
    for (const target of new Set(
      note.links.map((link) => resolve(link, note.path)).filter(Boolean),
    )) {
      const values = incoming.get(target!) || [];
      values.push(note.path);
      incoming.set(target!, values);
    }
  const normalize = (value: unknown, key: string, from: string, depth = 0): unknown => {
    if (depth > 20) throw Error("Слишком глубокое значение свойства");
    if (Array.isArray(value))
      return value.map((value) => normalize(value, key, from, depth + 1));
    if (value && typeof value === "object" && !(value instanceof Date))
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key))
          .map(([key, value]) => [key, normalize(value, key, from, depth + 1)]),
      );
    if (typeof value === "string") {
      if (/^\[\[[^]*\]\]$/.test(value) || /^https?:\/\//i.test(value))
        return environment.link(value, undefined, from);
      if (["date", "datetime"].includes(types[key])) {
        try {
          return parseBaseDate(value);
        } catch {
          return value;
        }
      }
    }
    return value;
  };
  const environment: BaseEnvironment = {
    source,
    file(value, from = source) {
      if (value instanceof BaseFile) return value;
      const path =
        value instanceof BaseLink
          ? value.resolved || resolve(value.path, value.source)
          : resolve(valueString(value).replace(/^\[\[|\]\]$/g, ""), from);
      if (!path) return null;
      if (cache.has(path)) return cache.get(path)!;
      const entry = entries.get(path),
        note: NoteIndex = known.get(path) || {
          path,
          title: entry?.name.replace(/\.[^.]+$/, "") || path.split("/").pop()!,
          aliases: [],
          tags: [],
          links: [],
          headings: [],
          properties: {},
          words: 0,
        };
      const file = new BaseFile(
        note,
        entry,
        normalize(note.properties, "", path) as Record<string, unknown>,
        note.links.map((target) => environment.link(target, undefined, path)),
        (note.embeds || []).map((target) => environment.link(target, undefined, path)),
      );
      cache.set(path, file);
      return file;
    },
    link(value, display, from = source) {
      if (value instanceof BaseLink && display === undefined) return value;
      const raw =
        value instanceof BaseFile
          ? value.path
          : value instanceof BaseLink
            ? value.path
            : valueString(value);
      const wiki = /^\[\[([^]*?)\]\]$/.exec(raw),
        parts = (wiki ? wiki[1] : raw).split("|");
      const path = parts[0],
        resolved = value instanceof BaseFile ? value.path : resolve(path, from);
      return new BaseLink(
        path,
        display ??
          parts[1] ??
          (resolved
            ? known.get(resolved)?.title || entries.get(resolved)?.name || path
            : path),
        from,
        resolved,
      );
    },
    backlinks(file) {
      return (incoming.get(file.path) || [])
        .map((path) => environment.file(path, "")!)
        .filter(Boolean);
    },
  };
  return environment;
}
