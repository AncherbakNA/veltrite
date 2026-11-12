import { Focus, GitBranch, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { plural } from "../../shared/format";
import type { GraphData } from "../../shared/graph";
import type { GraphOptions } from "../../shared/graph-options";
import type { FileEntry, NoteIndex } from "../../shared/types";
import GraphCanvas from "./GraphCanvas";
import GraphSettings from "./GraphSettings";
export default function Graph({
  index,
  onOpen,
  active,
  bookmark,
  onBookmark,
  options,
  onOptions,
  files,
}: {
  index: NoteIndex[];
  options: GraphOptions;
  onOptions: (options: GraphOptions) => void;
  files: FileEntry[];
  onOpen: (p: string) => void;
  active: string | null;
  bookmark: { query: string; local?: string; id: number } | null;
  onBookmark: (query: string, local?: string) => void;
}) {
  const [settings, setSettings] = useState(false);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; transform: typeof transform } | null>(null);
  const [query, setQuery] = useState(""),
    [local, setLocal] = useState(false),
    [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (bookmark) {
      setQuery(bookmark.query);
      setLocal(!!bookmark.local);
    }
  }, [bookmark]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    const worker = new Worker(new URL("../workers/graph.ts", import.meta.url), {
      type: "module",
    });
    const timeout = setTimeout(() => {
      worker.terminate();
      setError("Слишком сложный запрос графа");
      setLoading(false);
    }, 5000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      if (event.data.error) setError(event.data.error);
      else setGraph(event.data.graph);
      setLoading(false);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      setError("Не удалось построить граф");
      setLoading(false);
    };
    worker.postMessage({
      index,
      query,
      local,
      active: bookmark?.local || active,
      options,
      files,
    });
    return () => {
      clearTimeout(timeout);
      worker.terminate();
    };
  }, [index, query, local, active, bookmark, options, files]);
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
          <button
            aria-label="Настройки графа"
            aria-expanded={settings}
            onClick={() => setSettings((value) => !value)}
          >
            <SlidersHorizontal size={16} />
          </button>
          <input
            placeholder="Найти в графе…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            aria-label="Сохранить граф в закладки"
            onClick={() =>
              onBookmark(
                query,
                local ? bookmark?.local || active || undefined : undefined,
              )
            }
          >
            <Star size={16} />
          </button>
          <button className={local ? "active" : ""} onClick={() => setLocal((v) => !v)}>
            <Focus size={16} />
            {local ? "Локальный" : "Все заметки"}
          </button>
        </div>
      </div>
      {settings && (
        <GraphSettings
          options={options}
          onChange={(value) => {
            onOptions(value);
            setSettings(false);
          }}
        />
      )}
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
        <GraphCanvas graph={graph} active={active} onOpen={onOpen} options={options} />
      ) : (
        <svg
          className="graph-svg"
          viewBox="0 0 1000 660"
          tabIndex={0}
          aria-label="Поле графа"
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "0") setTransform({ x: 0, y: 0, scale: 1 });
            if (["+", "=", "-"].includes(e.key))
              setTransform((value) => ({
                ...value,
                scale: Math.max(
                  0.15,
                  Math.min(20, value.scale * (e.key === "-" ? 0.8 : 1.25)),
                ),
              }));
          }}
          onPointerDown={(e) => {
            if ((e.target as Element).closest(".graph-node")) return;
            drag.current = { x: e.clientX, y: e.clientY, transform };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (start) {
              const unit = Math.min(
                e.currentTarget.clientWidth / 1000,
                e.currentTarget.clientHeight / 660,
              );
              setTransform({
                ...start.transform,
                x: start.transform.x + (e.clientX - start.x) / unit,
                y: start.transform.y + (e.clientY - start.y) / unit,
              });
            }
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onWheel={(e) => {
            e.preventDefault();
            const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
              e.currentTarget.getScreenCTM()?.inverse(),
            );
            const scale = Math.max(
              0.15,
              Math.min(20, transform.scale * Math.exp(-e.deltaY * 0.002)),
            );
            setTransform({
              scale,
              x: point.x - ((point.x - transform.x) * scale) / transform.scale,
              y: point.y - ((point.y - transform.y) * scale) / transform.scale,
            });
          }}
        >
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="17"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
            </marker>
          </defs>
          <g
            transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}
          >
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
                  style={{ strokeWidth: options.linkScale }}
                  markerEnd={options.arrows ? "url(#graph-arrow)" : undefined}
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
                <circle
                  style={
                    node.color
                      ? { fill: node.color }
                      : node.kind === "tag"
                        ? { fill: "var(--green)" }
                        : undefined
                  }
                  r={Math.min(17, 6 + node.degree * 1.4) * options.nodeScale}
                />
                <title>{node.title}</title>
                {options.labels && (
                  <text y={24 + node.degree} textAnchor="middle">
                    {node.title}
                  </text>
                )}
              </g>
            ))}
          </g>
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
        <button
          className="text-link"
          onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
        >
          Вписать граф
        </button>
        <i />
        Заметка <i className="accent" />
        Текущая заметка <span>Нажмите на узел, чтобы открыть</span>
      </div>
    </div>
  );
}
