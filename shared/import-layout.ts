import {
  normalizeSession,
  type DocumentLeaf,
  type PaneLayout,
  type WorkspaceSession,
} from "./panes";
/** Translate file tabs and split directions; unsupported auxiliary views never become empty notes. */
export function importLayout(
  input: unknown,
  paths: Set<string>,
): WorkspaceSession | null {
  if (!input || typeof input !== "object") return null;
  const data = input as any,
    tabs: string[] = [],
    oldIds = new Map<string, string>();
  let count = 0,
    nodeId = 0;
  const fileOf = (leaf: any): string | null =>
    typeof leaf?.state?.state?.file === "string" && paths.has(leaf.state.state.file)
      ? leaf.state.state.file
      : null;
  const modeOf = (leaf: any): DocumentLeaf["mode"] =>
    leaf?.state?.state?.mode === "preview"
      ? "read"
      : leaf?.state?.state?.source === true
        ? "source"
        : "live";
  function parse(node: any, depth: number): PaneLayout | null {
    if (!node || typeof node !== "object" || depth > 7 || count >= 16) return null;
    if (node.type === "tabs" || node.type === "leaf") {
      const entries =
        node.type === "tabs"
          ? (Array.isArray(node.children) ? node.children : []).filter((leaf: any) =>
              fileOf(leaf),
            )
          : fileOf(node)
            ? [node]
            : [];
      if (!entries.length) return null;
      for (const leaf of entries) {
        const path = fileOf(leaf)!;
        if (tabs.length < 100 && !tabs.includes(path)) tabs.push(path);
      }
      const selected =
        node.type === "tabs" && Number.isInteger(node.activeTab)
          ? node.children[node.activeTab]
          : null;
      const leaf = fileOf(selected) ? selected : entries[0],
        id = "import-pane-" + ++nodeId;
      count++;
      for (const entry of entries)
        if (typeof entry.id === "string") oldIds.set(entry.id, id);
      return { kind: "leaf", id, path: fileOf(leaf), mode: modeOf(leaf) };
    }
    if (!Array.isArray(node.children)) return null;
    const children = node.children
      .map((child: any) => ({
        layout: parse(child, depth + 1),
        weight: Number.isFinite(child.width)
          ? Math.max(1, child.width)
          : Number.isFinite(child.height)
            ? Math.max(1, child.height)
            : 100,
      }))
      .filter((child: any) => child.layout);
    const combine = (items: typeof children): PaneLayout => {
      if (items.length === 1) return items[0].layout;
      const midpoint = Math.ceil(items.length / 2),
        first = items.slice(0, midpoint),
        second = items.slice(midpoint),
        weight = (values: typeof children) =>
          values.reduce((sum: number, item: any) => sum + item.weight, 0);
      return {
        kind: "split",
        id: "import-split-" + ++nodeId,
        direction: node.direction === "horizontal" ? "column" : "row",
        ratio: weight(first) / weight(items),
        first: combine(first),
        second: combine(second),
      };
    };
    return children.length ? combine(children) : null;
  }
  const layout = parse(data.main || data, 0);
  if (!layout || !tabs.length) return null;
  try {
    return normalizeSession(
      { tabs, active: tabs[0], layout, activePane: oldIds.get(data.active), pinned: [] },
      paths,
    );
  } catch {
    return normalizeSession({ tabs, active: tabs[0] }, paths);
  }
}
