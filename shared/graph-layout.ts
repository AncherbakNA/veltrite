import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { GraphData, GraphNode } from "./graph";
export function layoutGraph(graph: GraphData, maxMilliseconds = 1200): GraphData {
  if (!graph.nodes.length) return graph;
  const links = graph.edges.map((edge) => ({ source: edge.from, target: edge.to }));
  const simulation = forceSimulation<GraphNode>(graph.nodes)
    .stop()
    .force("charge", forceManyBody<GraphNode>().strength(-80).theta(1.1))
    .force(
      "links",
      forceLink<GraphNode, (typeof links)[number]>(links)
        .id((node) => node.path)
        .distance(65),
    )
    .force("collision", forceCollide<GraphNode>().radius(12))
    .force("center", forceCenter(0, 0));
  const started = performance.now();
  for (let i = 0; i < 90; i++) {
    simulation.tick();
    if (performance.now() - started > maxMilliseconds) break;
  }
  simulation.stop();
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const node of graph.nodes) {
    left = Math.min(left, node.x);
    right = Math.max(right, node.x);
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y);
  }
  const scale = Math.min(
    880 / Math.max(1, right - left),
    540 / Math.max(1, bottom - top),
  );
  for (const node of graph.nodes) {
    node.x = 500 + (node.x - (left + right) / 2) * scale;
    node.y = 330 + (node.y - (top + bottom) / 2) * scale;
  }
  return graph;
}
