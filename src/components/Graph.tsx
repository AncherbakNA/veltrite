import { Focus, GitBranch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { plural } from "../../shared/format";
import type { GraphData } from "../../shared/graph";
import type { NoteIndex } from "../../shared/types";
import GraphCanvas from "./GraphCanvas";
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
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    const worker = new Worker(new URL("../workers/graph.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      if (event.data.error) setError(event.data.error);
      else setGraph(event.data.graph);
      setLoading(false);
    };
    worker.onerror = () => {
      setError("Не удалось построить граф");
      setLoading(false);
    };
    worker.postMessage({ index, query, local, active });
    return () => worker.terminate();
  }, [index, query, local, active]);
  const byPath = useMemo(
    () => new Map(graph.nodes.map((node) => [node.path, node])),
    [graph],
  );
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
      {loading && (
        <small className="graph-status" role="status">
          Строим граф…
        </small>
      )}
      {error && <div className="save-error">{error}</div>}
      {!graph.nodes.length ? (
        <div className="canvas-empty">
          <h2>Здесь появятся связи</h2>
          <p>Создавайте заметки и связывайте их через [[двойные скобки]]</p>
        </div>
      ) : graph.nodes.length > 1000 ? (
        <GraphCanvas graph={graph} active={active} onOpen={onOpen} />
      ) : (
        <svg className="graph-svg" viewBox="0 0 1000 660">
          {graph.edges.map((edge, i) => {
            const a = byPath.get(edge.from),
              b = byPath.get(edge.to);
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
              role="button"
              tabIndex={0}
              aria-label={node.title}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(node.path);
                }
              }}
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
      {query && graph.nodes.length > 1000 && (
        <div className="graph-results">
          {graph.nodes.slice(0, 40).map((node) => (
            <button key={node.path} onClick={() => onOpen(node.path)}>
              {node.title}
            </button>
          ))}
        </div>
      )}
      <div className="graph-legend">
        <i />
        Заметка <i className="accent" />
        Текущая заметка <span>Нажмите на узел, чтобы открыть</span>
      </div>
    </div>
  );
}
