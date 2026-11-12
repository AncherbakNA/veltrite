import type { CanvasData, CanvasNode } from "./types";
export interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function viewport(
  transform: { x: number; y: number; scale: number },
  width: number,
  height: number,
  padding = 200,
): WorldRect {
  return {
    left: (-transform.x - padding) / transform.scale,
    top: (-transform.y - padding) / transform.scale,
    right: (width - transform.x + padding) / transform.scale,
    bottom: (height - transform.y + padding) / transform.scale,
  };
}
export function intersects(node: CanvasNode, rect: WorldRect): boolean {
  return (
    node.x + node.width >= rect.left &&
    node.x <= rect.right &&
    node.y + node.height >= rect.top &&
    node.y <= rect.bottom
  );
}
export function canvasVisibility(
  data: CanvasData,
  rect: WorldRect,
  selected: Set<string>,
) {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const nodes = data.nodes.filter(
    (node) => selected.has(node.id) || intersects(node, rect),
  );
  const edges = data.edges.filter((edge) => {
    const a = byId.get(edge.fromNode),
      b = byId.get(edge.toNode);
    if (!a || !b) return false;
    const bend = Math.max(
      60,
      Math.hypot(a.x - b.x, a.y - b.y, a.width, b.width, a.height, b.height) * 0.5,
    );
    return (
      selected.has(edge.id) ||
      (Math.min(a.x, b.x) - bend <= rect.right &&
        Math.max(a.x + a.width, b.x + b.width) + bend >= rect.left &&
        Math.min(a.y, b.y) - bend <= rect.bottom &&
        Math.max(a.y + a.height, b.y + b.height) + bend >= rect.top)
    );
  });
  return { nodes, edges, byId };
}
