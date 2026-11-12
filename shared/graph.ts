import { normalizePath } from "./links";
import type { NoteIndex } from "./types";
export interface GraphNode {
  path: string;
  title: string;
  degree: number;
  x: number;
  y: number;
}
export interface GraphEdge {
  from: string;
  to: string;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
/** Build path, title and alias lookups once instead of scanning the vault per edge. */
export function linkResolver(paths: string[], index: NoteIndex[]) {
  const known = new Set(paths),
    names = new Map<string, string>(),
    basenames = new Map<string, string>();
  for (const note of index)
    for (const name of [note.title, ...note.aliases]) {
      const lower = name.toLocaleLowerCase();
      if (!names.has(lower)) names.set(lower, note.path);
    }
  for (const path of paths) {
    const lower = path.split("/").pop()!.replace(/\.md$/i, "").toLocaleLowerCase();
    if (!basenames.has(lower)) basenames.set(lower, path);
  }
  return (target: string, from: string): string | null => {
    let clean = target.split("|")[0].split("#")[0];
    try {
      clean = decodeURIComponent(clean);
    } catch {}
    if (!clean) return from;
    const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    for (const item of [
      clean,
      /\.[^/]+$/.test(clean) ? clean : clean + ".md",
      clean + ".canvas",
    ]) {
      const relative = normalizePath(folder + item),
        absolute = normalizePath(item);
      if (relative && known.has(relative)) return relative;
      if (absolute && known.has(absolute)) return absolute;
    }
    const lower = clean.toLocaleLowerCase();
    return names.get(lower) || basenames.get(lower) || null;
  };
}
export function buildGraph(
  index: NoteIndex[],
  query: string,
  local: boolean,
  active: string | null,
): GraphData {
  const resolve = linkResolver(
      index.map((n) => n.path),
      index,
    ),
    edges: GraphEdge[] = [],
    degrees = new Map<string, number>(),
    connected = new Set<string>();
  for (const note of index)
    for (const link of note.links) {
      const target = resolve(link, note.path);
      if (!target || target === note.path) continue;
      edges.push({ from: note.path, to: target });
      degrees.set(note.path, (degrees.get(note.path) || 0) + 1);
      degrees.set(target, (degrees.get(target) || 0) + 1);
      if (note.path === active || target === active) {
        connected.add(note.path);
        connected.add(target);
      }
    }
  const lower = query.toLocaleLowerCase();
  const notes = index.filter(
    (n) =>
      (!lower ||
        n.title.toLocaleLowerCase().includes(lower) ||
        n.tags.some((t) => t.toLocaleLowerCase().includes(lower))) &&
      (!local || n.path === active || connected.has(n.path)),
  );
  const radius = Math.max(200, Math.sqrt(notes.length) * 24);
  const nodes = notes.map((note, i) => ({
    path: note.path,
    title: note.title,
    degree: degrees.get(note.path) || 0,
    x: Math.cos(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, notes.length)) * radius,
    y: Math.sin(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, notes.length)) * radius,
  }));
  const included = new Set(nodes.map((n) => n.path));
  return {
    nodes,
    edges: edges.filter((e) => included.has(e.from) && included.has(e.to)),
  };
}
