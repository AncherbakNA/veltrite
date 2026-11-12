import { defaultGraphOptions, type GraphOptions } from "./graph-options";
import { normalizePath } from "./links";
import { metadataPredicate } from "./search";
import type { FileEntry, NoteIndex } from "./types";
export interface GraphNode {
  path: string;
  title: string;
  degree: number;
  x: number;
  y: number;
  kind?: "note" | "tag" | "attachment" | "unresolved";
  color?: string;
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
  options: GraphOptions = defaultGraphOptions,
  files: FileEntry[] = [],
): GraphData {
  const known = options.attachments
    ? files.filter((file) => file.kind !== "folder").map((file) => file.path)
    : index.map((note) => note.path);
  const resolve = linkResolver(known, index),
    notes = new Map(index.map((note) => [note.path, note]));
  const candidates = new Map<
    string,
    { path: string; title: string; kind: GraphNode["kind"]; note?: NoteIndex }
  >(
    index.map((note) => [
      note.path,
      { path: note.path, title: note.title, kind: "note", note },
    ]),
  );
  if (options.attachments)
    for (const file of files)
      if (file.kind !== "folder" && !candidates.has(file.path))
        candidates.set(file.path, {
          path: file.path,
          title: file.name,
          kind: "attachment",
        });
  const edges: GraphEdge[] = [],
    seen = new Set<string>(),
    degrees = new Map<string, number>(),
    adjacency = new Map<string, Set<string>>();
  const edge = (from: string, to: string) => {
    const id = JSON.stringify([from, to]);
    if (from === to || seen.has(id)) return;
    seen.add(id);
    edges.push({ from, to });
    degrees.set(from, (degrees.get(from) || 0) + 1);
    degrees.set(to, (degrees.get(to) || 0) + 1);
    const add = (a: string, b: string) => {
      const values = adjacency.get(a) || new Set();
      values.add(b);
      adjacency.set(a, values);
    };
    if (options.direction !== "incoming") add(from, to);
    if (options.direction !== "outgoing") add(to, from);
  };
  for (const note of index) {
    for (const link of note.links) {
      let target = resolve(link, note.path);
      if (!target && options.unresolved && link) {
        target = "?" + link;
        candidates.set(target, { path: target, title: link, kind: "unresolved" });
      }
      if (target) edge(note.path, target);
    }
    if (options.tags)
      for (const tag of note.tags) {
        const target = "#" + tag;
        candidates.set(target, { path: target, title: target, kind: "tag" });
        edge(note.path, target);
      }
  }
  const connected = new Set<string>(active ? [active] : []);
  let frontier = [...connected];
  if (local)
    for (let depth = 0; depth < options.depth && frontier.length; depth++) {
      const next: string[] = [];
      for (const path of frontier)
        for (const target of adjacency.get(path) || [])
          if (!connected.has(target)) {
            connected.add(target);
            next.push(target);
          }
      frontier = next;
    }
  const matches = metadataPredicate(query),
    groups = options.groups.map((group) => ({
      ...group,
      matches: metadataPredicate(group.query),
    }));
  const included = [...candidates.values()].filter((entry) => {
    if (local && !connected.has(entry.path)) return false;
    if (!options.orphans && !degrees.get(entry.path) && entry.path !== active)
      return false;
    const note = entry.note || {
      path: entry.path,
      title: entry.title,
      tags: entry.kind === "tag" ? [entry.title.slice(1)] : [],
      aliases: [],
      links: [],
      properties: {},
      headings: [],
      words: 0,
    };
    return matches(note);
  });
  const radius = Math.max(200, Math.sqrt(included.length) * 24);
  const nodes = included.map((entry, i) => ({
    path: entry.path,
    title: entry.title,
    degree: degrees.get(entry.path) || 0,
    kind: entry.kind,
    color: groups.find((group) =>
      group.matches(
        notes.get(entry.path) || {
          path: entry.path,
          title: entry.title,
          tags: [],
          aliases: [],
          links: [],
          properties: {},
          headings: [],
          words: 0,
        },
      ),
    )?.color,
    x:
      Math.cos(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, included.length)) * radius,
    y:
      Math.sin(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, included.length)) * radius,
  }));
  const paths = new Set(nodes.map((node) => node.path));
  return {
    nodes,
    edges: edges.filter((edge) => paths.has(edge.from) && paths.has(edge.to)),
  };
}
