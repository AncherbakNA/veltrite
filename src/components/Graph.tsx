import { Focus, GitBranch } from "lucide-react";
import { useMemo, useState } from "react";
import { plural } from "../../shared/format";
import { resolveLink } from "../../shared/markdown";
import type { NoteIndex } from "../../shared/types";
export default function Graph({
  index,
  onOpen,
  active,
}: {
  index: NoteIndex[];
  onOpen: (p: string) => void;
  active: string | null;
}) {
  const [query, setQuery] = useState(""),
    [local, setLocal] = useState(false),
    [hovered, setHovered] = useState<string | null>(null);
  const graph = useMemo(() => {
    const paths = index.map((n) => n.path),
      edges = index.flatMap((n) =>
        n.links.flatMap((link) => {
          const target = resolveLink(link, n.path, paths, index);
          return target && target !== n.path ? [{ from: n.path, to: target }] : [];
        }),
      );
    const connected = new Set(
      edges
        .filter((e) => e.from === active || e.to === active)
        .flatMap((e) => [e.from, e.to]),
    );
    const notes = index
      .filter(
        (n) =>
          (!query ||
            n.title.toLowerCase().includes(query.toLowerCase()) ||
            n.tags.some((t) => t.includes(query))) &&
          (!local || n.path === active || connected.has(n.path)),
      )
      .slice(0, 500);
    const nodes = notes.map((n, i) => ({
      ...n,
      x:
        500 +
        Math.cos(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, notes.length)) * 330,
      y:
        330 +
        Math.sin(i * 2.399963) * Math.sqrt((i + 1) / Math.max(1, notes.length)) * 260,
      degree: edges.filter((e) => e.from === n.path || e.to === n.path).length,
    }));
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    const neighbors = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!byPath.has(edge.from) || !byPath.has(edge.to)) continue;
      if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
      if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
      neighbors.get(edge.from)!.add(edge.to);
      neighbors.get(edge.to)!.add(edge.from);
    }
    for (let iteration = 0; iteration < 50; iteration++)
      for (const node of nodes) {
        let dx = (500 - node.x) * 0.002,
          dy = (330 - node.y) * 0.002;
        for (const other of nodes) {
          if (node === other) continue;
          const x = node.x - other.x,
            y = node.y - other.y,
            distance = Math.max(30, Math.hypot(x, y));
          dx += (x / (distance * distance)) * 12;
          dy += (y / (distance * distance)) * 12;
        }
        for (const neighbor of neighbors.get(node.path) || []) {
          const other = byPath.get(neighbor)!;
          dx += (other.x - node.x) * 0.003;
          dy += (other.y - node.y) * 0.003;
        }
        node.x = Math.max(50, Math.min(950, node.x + dx));
        node.y = Math.max(50, Math.min(600, node.y + dy));
      }
    return { nodes, edges };
  }, [index, query, local, active]);
  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <div>
          <GitBranch size={19} />
          <h2>Граф знаний</h2>
          <span className="badge">
            {plural(graph.nodes.length, ["заметка", "заметки", "заметок"])}
          </span>
        </div>
        <div>
          <input
            placeholder="Найти в графе…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className={local ? "active" : ""} onClick={() => setLocal((v) => !v)}>
            <Focus size={16} />
            {local ? "Локальный" : "Все заметки"}
          </button>
        </div>
      </div>
      {!graph.nodes.length ? (
        <div className="canvas-empty">
          <h2>Здесь появятся связи</h2>
          <p>Создавайте заметки и связывайте их через [[двойные скобки]]</p>
        </div>
      ) : (
        <svg className="graph-svg" viewBox="0 0 1000 660">
          {graph.edges.map((edge, i) => {
            const a = graph.nodes.find((n) => n.path === edge.from),
              b = graph.nodes.find((n) => n.path === edge.to);
            return a && b ? (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={hovered === a.path || hovered === b.path ? "highlight" : ""}
              />
            ) : null;
          })}
          {graph.nodes.map((node) => (
            <g
              key={node.path}
              className={"graph-node " + (node.path === active ? "current" : "")}
              transform={`translate(${node.x},${node.y})`}
              onClick={() => onOpen(node.path)}
              onMouseEnter={() => setHovered(node.path)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle r={Math.min(17, 6 + node.degree * 1.4)} />
              <text y={24 + node.degree} textAnchor="middle">
                {node.title}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div className="graph-legend">
        <i />
        Заметка <i className="accent" />
        Текущая заметка <span>Нажмите на узел, чтобы открыть</span>
      </div>
    </div>
  );
}
