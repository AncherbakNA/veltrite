/** Portable window layout. Note contents remain in the shared tab cache. */
export type PaneMode = "live" | "source" | "read" | "split";
export interface DocumentLeaf {
  kind: "leaf";
  id: string;
  path: string | null;
  mode: PaneMode;
}
export interface DocumentSplit {
  kind: "split";
  id: string;
  direction: "row" | "column";
  ratio: number;
  first: PaneLayout;
  second: PaneLayout;
}
export type PaneLayout = DocumentLeaf | DocumentSplit;
export interface WorkspaceSession {
  tabs: string[];
  active: string | null;
  layout?: PaneLayout;
  activePane?: string;
  pinned?: string[];
}
export const singlePane = (path: string | null, id = "main"): DocumentLeaf => ({
  kind: "leaf",
  id,
  path,
  mode: "live",
});
export function leaves(layout: PaneLayout): DocumentLeaf[] {
  return layout.kind === "leaf"
    ? [layout]
    : [...leaves(layout.first), ...leaves(layout.second)];
}
export function updatePane(
  layout: PaneLayout,
  id: string,
  update: (node: PaneLayout) => PaneLayout,
): PaneLayout {
  if (layout.id === id) return update(layout);
  return layout.kind === "leaf"
    ? layout
    : {
        ...layout,
        first: updatePane(layout.first, id, update),
        second: updatePane(layout.second, id, update),
      };
}
export function removePane(layout: PaneLayout, id: string): PaneLayout | null {
  if (layout.id === id) return null;
  if (layout.kind === "leaf") return layout;
  const first = removePane(layout.first, id),
    second = removePane(layout.second, id);
  return first && second ? { ...layout, first, second } : first || second;
}
/** Bounds and unique IDs protect both persistence and recursive rendering. */
export function normalizeSession(
  input: unknown,
  allowedPaths?: Set<string>,
): WorkspaceSession {
  if (!input || typeof input !== "object")
    throw Error("Некорректное рабочее пространство");
  const data = input as WorkspaceSession;
  if (
    !Array.isArray(data.tabs) ||
    data.tabs.length > 100 ||
    data.tabs.some((p) => typeof p !== "string" || p.length > 2048)
  )
    throw Error("Некорректный список вкладок");
  const tabs = [...new Set(data.tabs)].filter(
    (p) => !allowedPaths || allowedPaths.has(p),
  );
  const active =
    typeof data.active === "string" && tabs.includes(data.active)
      ? data.active
      : tabs.at(-1) || null;
  const ids = new Set<string>();
  let count = 0;
  function parse(value: unknown, depth: number): PaneLayout {
    if (!value || typeof value !== "object" || depth > 8)
      throw Error("Некорректная структура панелей");
    const node = value as PaneLayout;
    if (typeof node.id !== "string" || !/^[\w-]{1,80}$/.test(node.id) || ids.has(node.id))
      throw Error("Некорректный идентификатор панели");
    ids.add(node.id);
    if (node.kind === "leaf") {
      if (++count > 16) throw Error("Можно открыть до 16 панелей");
      return {
        kind: "leaf",
        id: node.id,
        path: node.path && tabs.includes(node.path) ? node.path : null,
        mode: ["live", "source", "read", "split"].includes(node.mode)
          ? node.mode
          : "live",
      };
    }
    if (
      node.kind !== "split" ||
      !["row", "column"].includes(node.direction) ||
      !Number.isFinite(node.ratio)
    )
      throw Error("Некорректное разделение панелей");
    return {
      kind: "split",
      id: node.id,
      direction: node.direction,
      ratio: Math.max(0.15, Math.min(0.85, node.ratio)),
      first: parse(node.first, depth + 1),
      second: parse(node.second, depth + 1),
    };
  }
  const layout = data.layout ? parse(data.layout, 0) : singlePane(active);
  const panels = leaves(layout);
  const focused =
    panels.find((p) => p.id === data.activePane) ||
    panels.find((p) => p.path === active) ||
    panels[0];
  return {
    tabs,
    active: focused.path,
    layout,
    activePane: focused.id,
    pinned: Array.isArray(data.pinned)
      ? [...new Set(data.pinned.filter((path) => tabs.includes(path)))]
      : [],
  };
}
