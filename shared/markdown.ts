import { parse as parseYaml } from "yaml";
import { normalizePath } from "./links";
import { referenceBlocks } from "./markdown-blocks";
import type { NoteIndex } from "./types";
function plainProperties(value: unknown, active = new Set<object>(), depth = 0): unknown {
  if (depth > 20) throw Error("Слишком глубокие свойства");
  if (!value || typeof value !== "object") return value;
  if (active.has(value)) throw Error("Цикл в свойствах");
  active.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => plainProperties(item, active, depth + 1));
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key))
        .map(([key, item]) => [key, plainProperties(item, active, depth + 1)]),
    );
  } finally {
    active.delete(value);
  }
}
export function frontmatter(text: string): {
  properties: Record<string, unknown>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { properties: {}, body: text };
  try {
    if (m[1].length > 262144) throw Error("Слишком большие свойства");
    const value = plainProperties(parseYaml(m[1], { maxAliasCount: 30 }));
    return {
      properties:
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {},
      body: text.slice(m[0].length),
    };
  } catch {
    return { properties: {}, body: text };
  }
}
export function indexNote(path: string, content: string): NoteIndex {
  const { properties, body } = frontmatter(content);
  const scrubbed = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
  const aliases = Array.isArray(properties.aliases)
    ? properties.aliases.map(String)
    : typeof properties.aliases === "string"
      ? [properties.aliases]
      : [];
  const tags = new Set<string>(
    Array.isArray(properties.tags)
      ? properties.tags.map(String)
      : typeof properties.tags === "string"
        ? properties.tags.split(/[, ]+/)
        : [],
  );
  for (const m of scrubbed.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) tags.add(m[1]);
  const links = [...scrubbed.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(
    (m) => m[1].split("#")[0],
  );
  for (const m of scrubbed.matchAll(/\[[^\]]*\]\(([^)]+)\)/g))
    if (!/^[a-z]+:/i.test(m[1]) && !m[1].startsWith("#")) {
      try {
        links.push(decodeURIComponent(m[1]).split("#")[0]);
      } catch {
        links.push(m[1]);
      }
    }
  const headerLines =
    content.slice(0, content.length - body.length).split("\n").length - 1;
  let fence: string | null = null;
  const headings = body.split("\n").flatMap((line, i) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1]?.[0];
    if (marker) {
      fence = fence === marker ? null : marker;
      return [];
    }
    if (fence) return [];
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    return m ? [{ level: m[1].length, text: m[2], line: i + 1 + headerLines }] : [];
  });
  return {
    path,
    title: path.split("/").pop()!.replace(/\.md$/i, ""),
    aliases,
    tags: [...tags].filter(Boolean),
    links: links.filter(Boolean),
    headings,
    properties,
    blocks: referenceBlocks(content).map(({ id, line }) => ({ id, line })),
    words: body.match(/[\p{L}\p{N}]+/gu)?.length || 0,
  };
}
export function resolveLink(
  target: string,
  from: string,
  paths: string[],
  index: NoteIndex[] = [],
): string | null {
  let clean = target.split("|")[0].split("#")[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {}
  if (!clean) return from;
  const options = [
    clean,
    /\.[^/]+$/.test(clean) ? clean : clean + ".md",
    clean + ".canvas",
  ];
  const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  for (const item of options) {
    const relative = normalizePath(folder + item);
    if (relative && paths.includes(relative)) return relative;
    const absolute = normalizePath(item);
    if (absolute && paths.includes(absolute)) return absolute;
  }
  const lower = clean.toLocaleLowerCase();
  return (
    index.find(
      (n) =>
        n.title.toLocaleLowerCase() === lower ||
        n.aliases.some((a) => a.toLocaleLowerCase() === lower),
    )?.path ||
    paths.find(
      (p) => p.split("/").pop()?.replace(/\.md$/i, "").toLocaleLowerCase() === lower,
    ) ||
    null
  );
}
export function validateCanvas(value: unknown) {
  if (!value || typeof value !== "object") throw Error("Некорректный холст");
  const data = value as any;
  if (data.nodes === undefined) data.nodes = [];
  if (data.edges === undefined) data.edges = [];
  if (
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.edges) ||
    data.nodes.length > 10000 ||
    data.edges.length > 20000
  )
    throw Error("Некорректный холст");
  const ids = new Set<string>();
  for (const n of data.nodes) {
    if (
      !n ||
      typeof n.id !== "string" ||
      ids.has(n.id) ||
      !["text", "file", "link", "group"].includes(n.type) ||
      !["x", "y", "width", "height"].every((k) => Number.isFinite(n[k])) ||
      n.width <= 0 ||
      n.height <= 0
    )
      throw Error("Некорректная карточка холста");
    if (
      (n.type === "text" && typeof n.text !== "string") ||
      (n.type === "file" && typeof n.file !== "string") ||
      (n.type === "link" && typeof n.url !== "string") ||
      (n.type === "group" && n.label !== undefined && typeof n.label !== "string")
    )
      throw Error("Некорректное содержимое карточки холста");
    ids.add(n.id);
  }
  for (const e of data.edges)
    if (!e || typeof e.id !== "string" || !ids.has(e.fromNode) || !ids.has(e.toNode))
      throw Error("Некорректная связь холста");
  return data as import("./types").CanvasData;
}
