import {
  BaseDuration,
  BaseFile,
  BaseHtml,
  BaseIcon,
  BaseImage,
  BaseLink,
} from "./base-values";
export type BaseDisplayValue =
  | null
  | string
  | number
  | boolean
  | Date
  | BaseDisplayValue[]
  | {
      kind: "link" | "url";
      path: string;
      source: string;
      resolved: string | null;
      label: BaseDisplayValue;
    }
  | { kind: "image"; path: string }
  | { kind: "icon"; name: string }
  | { kind: "html"; html: string }
  | { kind: "duration"; milliseconds: number; months: number }
  | { kind: "object"; text: string }
  | { kind: "error"; message: string };
export function measureBaseValue(value: unknown, maximum = 4 * 1024 * 1024): number {
  let bytes = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > 16) throw Error("Слишком глубокий результат формулы");
    bytes += 32;
    if (typeof value === "string") bytes += value.length * 2;
    else if (value instanceof BaseFile)
      bytes += value.path.length * 2 + value.basename.length * 2;
    else if (value instanceof BaseLink) {
      bytes +=
        (value.path.length + value.source.length + (value.resolved?.length || 0)) * 2;
      visit(value.display, depth + 1);
    } else if (value instanceof BaseImage) bytes += value.path.length * 2;
    else if (value instanceof BaseHtml) bytes += value.html.length * 2;
    else if (value instanceof BaseIcon) bytes += value.name.length * 2;
    else if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
    else if (
      value &&
      typeof value === "object" &&
      !(value instanceof Date) &&
      !(value instanceof BaseDuration) &&
      !(value instanceof RegExp)
    )
      for (const [key, item] of Object.entries(value)) {
        bytes += key.length * 2;
        visit(item, depth + 1);
      }
    if (bytes > maximum) throw Error("Результат формулы слишком большой");
  };
  visit(value, 0);
  return bytes;
}
export function displayBaseValue(value: unknown, depth = 0): BaseDisplayValue {
  if (depth === 0) measureBaseValue(value);
  if (depth > 16) throw Error("Слишком глубокий результат формулы");
  if (value == null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  )
    return value;
  if (value instanceof BaseFile)
    return {
      kind: "link",
      path: value.path,
      source: "",
      resolved: value.path,
      label: value.basename,
    };
  if (value instanceof BaseLink)
    return {
      kind: value.kind,
      path: value.path,
      source: value.source,
      resolved: value.resolved,
      label: displayBaseValue(value.display, depth + 1),
    };
  if (value instanceof BaseImage) return { kind: "image", path: value.path };
  if (value instanceof BaseIcon) return { kind: "icon", name: value.name };
  if (value instanceof BaseHtml) return { kind: "html", html: value.html };
  if (value instanceof BaseDuration)
    return { kind: "duration", milliseconds: value.milliseconds, months: value.months };
  if (Array.isArray(value)) return value.map((item) => displayBaseValue(item, depth + 1));
  if (typeof value === "function")
    throw Error("Формула должна возвращать значение, а не функцию");
  if (value instanceof RegExp) return value.toString();
  return {
    kind: "object",
    text: JSON.stringify(
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          displayBaseValue(item, depth + 1),
        ]),
      ),
    ),
  };
}
export function displayBaseText(value: BaseDisplayValue | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString("ru-RU");
  if (Array.isArray(value)) return value.map(displayBaseText).join(", ");
  if (typeof value !== "object") return String(value);
  if (value.kind === "link" || value.kind === "url") return displayBaseText(value.label);
  if (value.kind === "duration") {
    const ms = value.milliseconds,
      prefix = value.months ? value.months + " мес. " : "";
    if (Math.abs(ms) >= 86400000 && ms % 86400000 === 0)
      return prefix + ms / 86400000 + " дн.";
    if (Math.abs(ms) >= 3600000 && ms % 3600000 === 0)
      return prefix + ms / 3600000 + " ч";
    return prefix + ms + " мс";
  }
  if (value.kind === "image") return value.path;
  if (value.kind === "icon") return value.name;
  if (value.kind === "html") return value.html;
  if (value.kind === "error") return "⚠ " + value.message;
  return "text" in value ? value.text : "";
}
