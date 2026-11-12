import {
  ArrowUpRight,
  FileText,
  Group,
  Link,
  Maximize,
  MousePointer2,
  Move,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { plural } from "../../shared/format";
import { validateCanvas } from "../../shared/markdown";
import type { CanvasData, CanvasNode, NoteIndex } from "../../shared/types";
import { api } from "../useVault";
import Markdown, { assetUrl } from "./Markdown";
const palette: Record<string, string> = {
  "1": "#e27b84",
  "2": "#dea26f",
  "3": "#d9c176",
  "4": "#8fbe9b",
  "5": "#7cbcca",
  "6": "#b29aeb",
};
function color(value?: string) {
  return value
    ? palette[value] || (/^#[0-9a-f]{6}$/i.test(value) ? value : "var(--accent)")
    : "var(--border-strong)";
}
function FileCard({
  file,
  index,
  onOpen,
}: {
  file: string;
  index: NoteIndex[];
  onOpen: (p: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (file.toLowerCase().endsWith(".md"))
      api()
        .read(file)
        .then((n) => setText(n.content))
        .catch(() => setText("Файл не найден"));
  }, [file, index]);
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(file))
    return <img src={assetUrl(file)} alt={file} draggable={false} />;
  if (file.toLowerCase().endsWith(".md"))
    return <Markdown content={text} path={file} index={index} onLink={onOpen} />;
  return <button onClick={() => onOpen(file)}>Открыть {file}</button>;
}
export default function Canvas({
  content,
  onChange,
  index,
  onOpen,
  onChooseFile,
  onChooseLink,
}: {
  content: string;
  onChange: (text: string) => void;
  index: NoteIndex[];
  onOpen: (p: string) => void;
  onChooseFile: (add: (file: string) => void) => void;
  onChooseLink: (add: (url: string) => void) => void;
}) {
  const parse = useMemo(() => {
    try {
      return { data: validateCanvas(JSON.parse(content)), error: null };
    } catch (e: any) {
      return { data: { nodes: [], edges: [] } as CanvasData, error: e.message };
    }
  }, [content]);
  const data = parse.data,
    host = useRef<HTMLDivElement>(null),
    dataRef = useRef(data),
    contentRef = useRef(content);
  const [transform, setTransform] = useState({ x: 80, y: 70, scale: 1 }),
    transformRef = useRef(transform);
  const [selected, setSelected] = useState<string[]>([]),
    [connect, setConnect] = useState(false),
    [panMode, setPanMode] = useState(false);
  const drag = useRef<any>(null),
    undo = useRef<string[]>([]),
    redo = useRef<string[]>([]),
    clipboard = useRef<CanvasNode[]>([]);
  dataRef.current = data;
  contentRef.current = content;
  transformRef.current = transform;
  const commit = (next: CanvasData, remember = true) => {
    if (remember) {
      undo.current.push(contentRef.current);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
    }
    dataRef.current = next;
    const text = JSON.stringify(next, null, 2);
    contentRef.current = text;
    onChange(text);
  };
  const fit = () => {
    const nodes = dataRef.current.nodes;
    if (!nodes.length) {
      setTransform({ x: 80, y: 70, scale: 1 });
      return;
    }
    const left = Math.min(...nodes.map((n) => n.x)),
      top = Math.min(...nodes.map((n) => n.y)),
      right = Math.max(...nodes.map((n) => n.x + n.width)),
      bottom = Math.max(...nodes.map((n) => n.y + n.height));
    const width = host.current?.clientWidth || 900,
      height = host.current?.clientHeight || 600;
    const scale = Math.min(
      1.2,
      Math.max(
        0.12,
        Math.min((width - 120) / (right - left), (height - 150) / (bottom - top)),
      ),
    );
    setTransform({
      x: (width - (right - left) * scale) / 2 - left * scale,
      y: (height - (bottom - top) * scale) / 2 - top * scale,
      scale,
    });
  };
  useEffect(() => {
    const timer = setTimeout(fit, 40);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = transformRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = element.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top,
          scale = Math.min(2.5, Math.max(0.12, t.scale * Math.exp(-e.deltaY * 0.007)));
        setTransform({
          x: x - ((x - t.x) * scale) / t.scale,
          y: y - ((y - t.y) * scale) / t.scale,
          scale,
        });
      } else setTransform({ ...t, x: t.x - e.deltaX, y: t.y - e.deltaY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const center = () => {
    const t = transformRef.current;
    return {
      x: Math.round(((host.current?.clientWidth || 900) / 2 - t.x) / t.scale - 160),
      y: Math.round(((host.current?.clientHeight || 600) / 2 - t.y) / t.scale - 100),
    };
  };
  const add = (type: CanvasNode["type"], value = "") => {
    const point = center();
    let attempts = 0;
    while (
      dataRef.current.nodes.some(
        (n) => Math.abs(n.x - point.x) < 350 && Math.abs(n.y - point.y) < 230,
      ) &&
      attempts++ < 100
    ) {
      point.x += 390;
      if (attempts % 3 === 0) {
        point.x -= 1170;
        point.y += 280;
      }
    }
    const node = {
      id: crypto.randomUUID(),
      ...point,
      width: type === "group" ? 520 : 340,
      height: type === "group" ? 380 : 230,
      type,
      ...(type === "text"
        ? { text: "" }
        : type === "file"
          ? { file: value }
          : type === "link"
            ? { url: value }
            : { label: "Группа" }),
    } as CanvasNode;
    commit({
      ...dataRef.current,
      nodes:
        type === "group"
          ? [node, ...dataRef.current.nodes]
          : [...dataRef.current.nodes, node],
    });
    setSelected([node.id]);
    queueMicrotask(fit);
  };
  const remove = () => {
    commit({
      ...dataRef.current,
      nodes: dataRef.current.nodes.filter((n) => !selected.includes(n.id)),
      edges: dataRef.current.edges.filter(
        (e) =>
          !selected.includes(e.id) &&
          !selected.includes(e.fromNode) &&
          !selected.includes(e.toNode),
      ),
    });
    setSelected([]);
  };
  const point = (node: CanvasNode, side = "right") =>
    side === "top"
      ? { x: node.x + node.width / 2, y: node.y }
      : side === "bottom"
        ? { x: node.x + node.width / 2, y: node.y + node.height }
        : side === "left"
          ? { x: node.x, y: node.y + node.height / 2 }
          : { x: node.x + node.width, y: node.y + node.height / 2 };
  return (
    <div
      className={"canvas-view " + (panMode ? "pan-mode" : "")}
      ref={host}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches("textarea,input")) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
        }
        if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
          e.preventDefault();
          const stack = e.shiftKey ? redo : undo,
            target = e.shiftKey ? undo : redo,
            last = stack.current.pop();
          if (last) {
            target.current.push(contentRef.current);
            onChange(last);
          }
        }
        if ((e.metaKey || e.ctrlKey) && e.code === "KeyC") {
          e.preventDefault();
          clipboard.current = data.nodes.filter((n) => selected.includes(n.id));
        }
        if ((e.metaKey || e.ctrlKey) && e.code === "KeyV") {
          e.preventDefault();
          const nodes = clipboard.current.map((n) => ({
            ...n,
            id: crypto.randomUUID(),
            x: n.x + 40,
            y: n.y + 40,
          }));
          commit({ ...data, nodes: [...data.nodes, ...nodes] });
          setSelected(nodes.map((n) => n.id));
        }
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || panMode || e.button === 1) {
          e.preventDefault();
          host.current?.focus();
          if (!e.shiftKey) setSelected([]);
          drag.current = {
            kind: "pan",
            x: e.clientX,
            y: e.clientY,
            t: transformRef.current,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        const moving = drag.current;
        if (!moving) return;
        if (moving.kind === "pan")
          setTransform({
            ...moving.t,
            x: moving.t.x + e.clientX - moving.x,
            y: moving.t.y + e.clientY - moving.y,
          });
        else if (moving.kind === "node") {
          const dx = (e.clientX - moving.x) / transform.scale,
            dy = (e.clientY - moving.y) / transform.scale;
          commit(
            {
              ...dataRef.current,
              nodes: dataRef.current.nodes.map((n) =>
                moving.original[n.id]
                  ? {
                      ...n,
                      x: Math.round(moving.original[n.id].x + dx),
                      y: Math.round(moving.original[n.id].y + dy),
                    }
                  : n,
              ),
            },
            false,
          );
        } else if (moving.kind === "resize") {
          commit(
            {
              ...dataRef.current,
              nodes: dataRef.current.nodes.map((n) =>
                n.id === moving.id
                  ? {
                      ...n,
                      width: Math.round(
                        Math.max(
                          180,
                          moving.width + (e.clientX - moving.x) / transform.scale,
                        ),
                      ),
                      height: Math.round(
                        Math.max(
                          100,
                          moving.height + (e.clientY - moving.y) / transform.scale,
                        ),
                      ),
                    }
                  : n,
              ),
            },
            false,
          );
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div className="canvas-topbar">
        <button
          title="Указатель"
          className={!panMode ? "active" : ""}
          onClick={() => setPanMode(false)}
        >
          <MousePointer2 size={17} />
        </button>
        <button
          title="Перемещение"
          className={panMode ? "active" : ""}
          onClick={() => setPanMode(true)}
        >
          <Move size={17} />
        </button>
        <i />
        <button
          title="Текстовая карточка"
          aria-label="Текстовая карточка"
          onClick={() => add("text")}
        >
          <Plus size={18} />
          <span>Текст</span>
        </button>
        <button
          title="Добавить заметку или изображение"
          onClick={() => onChooseFile((file) => add("file", file))}
        >
          <FileText size={17} />
          <span>Файл</span>
        </button>
        <button
          title="Добавить ссылку"
          onClick={() => onChooseLink((url) => add("link", url))}
        >
          <Link size={17} />
        </button>
        <button title="Группа" onClick={() => add("group")}>
          <Group size={17} />
        </button>
        <i />
        <button
          title="Соединить две карточки"
          className={connect ? "active" : ""}
          onClick={() => {
            setSelected([]);
            setConnect((v) => !v);
          }}
        >
          <ArrowUpRight size={19} />
          <span>Связь</span>
        </button>
        {selected.length > 0 && (
          <>
            <i />
            {Object.entries(palette).map(([id, c]) => (
              <button
                key={id}
                className="color-dot"
                style={{ background: c }}
                title="Цвет карточки"
                onClick={() =>
                  commit({
                    ...data,
                    nodes: data.nodes.map((n) =>
                      selected.includes(n.id) ? { ...n, color: id } : n,
                    ),
                    edges: data.edges.map((edge) =>
                      selected.includes(edge.id) ? { ...edge, color: id } : edge,
                    ),
                  })
                }
              />
            ))}
            <button title="Удалить выбранное" onClick={remove}>
              <Trash2 size={16} />
            </button>
          </>
        )}
        {data.edges
          .filter((edge) => selected.includes(edge.id))
          .slice(0, 1)
          .map((edge) => (
            <input
              key={edge.id}
              className="edge-label-input"
              aria-label="Подпись связи"
              placeholder="Подпись связи"
              value={edge.label || ""}
              onChange={(event) =>
                commit({
                  ...data,
                  edges: data.edges.map((item) =>
                    item.id === edge.id ? { ...item, label: event.target.value } : item,
                  ),
                })
              }
            />
          ))}
      </div>
      {parse.error && (
        <div className="canvas-error">
          {parse.error}. Файл сохранён без изменений. Откройте режим исходного кода.
        </div>
      )}
      {connect && (
        <div className="canvas-hint">Выберите начальную и конечную карточку</div>
      )}
      {!data.nodes.length && !parse.error && (
        <div className="canvas-empty">
          <PanelsIcon />
          <h2>Пустой холст</h2>
          <p>Добавьте карточки, заметки и связи между ними</p>
          <button className="primary" onClick={() => add("text")}>
            <Plus size={16} />
            Первая карточка
          </button>
        </div>
      )}
      <div
        className="canvas-world"
        style={{
          transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <svg className="canvas-edges">
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {data.edges.map((edge) => {
            const from = data.nodes.find((n) => n.id === edge.fromNode),
              to = data.nodes.find((n) => n.id === edge.toNode);
            if (!from || !to) return null;
            const a = point(from, edge.fromSide),
              b = point(to, edge.toSide || "left"),
              bend = Math.max(60, Math.abs(a.x - b.x) * 0.5);
            return (
              <g
                key={edge.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected([edge.id]);
                }}
              >
                <path
                  className={"edge " + (selected.includes(edge.id) ? "selected" : "")}
                  d={`M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`}
                  stroke={color(edge.color)}
                  markerEnd={edge.toEnd === "none" ? undefined : "url(#arrow)"}
                  markerStart={edge.fromEnd === "arrow" ? "url(#arrow)" : undefined}
                />
                {edge.label && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} textAnchor="middle">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {data.nodes.map((node) => (
          <div
            key={node.id}
            className={
              "canvas-node " + node.type + (selected.includes(node.id) ? " selected" : "")
            }
            style={
              {
                left: node.x,
                top: node.y,
                width: node.width,
                height: node.height,
                borderColor: color(node.color),
                "--node-color": color(node.color),
              } as React.CSSProperties
            }
            onClick={(e) => {
              e.stopPropagation();
              if (connect) {
                if (selected.length === 1 && selected[0] !== node.id) {
                  commit({
                    ...data,
                    edges: [
                      ...data.edges,
                      {
                        id: crypto.randomUUID(),
                        fromNode: selected[0],
                        toNode: node.id,
                        fromSide: "right",
                        toSide: "left",
                      },
                    ],
                  });
                  setConnect(false);
                  setSelected([]);
                } else setSelected([node.id]);
              } else if (e.shiftKey)
                setSelected((old) =>
                  old.includes(node.id)
                    ? old.filter((id) => id !== node.id)
                    : [...old, node.id],
                );
              else setSelected([node.id]);
            }}
          >
            <div
              className="canvas-node-header"
              onPointerDown={(e) => {
                if (connect) return;
                e.stopPropagation();
                host.current?.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                const ids = selected.includes(node.id) ? selected : [node.id];
                setSelected(ids);
                const included = data.nodes.filter(
                  (n) =>
                    ids.includes(n.id) ||
                    (node.type === "group" &&
                      n.x >= node.x &&
                      n.y >= node.y &&
                      n.x + n.width <= node.x + node.width &&
                      n.y + n.height <= node.y + node.height),
                );
                undo.current.push(contentRef.current);
                redo.current = [];
                drag.current = {
                  kind: "node",
                  x: e.clientX,
                  y: e.clientY,
                  original: Object.fromEntries(
                    included.map((n) => [n.id, { x: n.x, y: n.y }]),
                  ),
                };
              }}
            >
              <span>
                {node.type === "text"
                  ? "Текст"
                  : node.type === "file"
                    ? node.file
                    : node.type === "link"
                      ? node.url
                      : node.label || "Группа"}
              </span>
              {node.type === "file" && (
                <button title="Открыть файл" onClick={() => onOpen(node.file)}>
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
            {node.type === "text" && (
              <textarea
                aria-label="Текст карточки"
                placeholder="Текст карточки…"
                value={node.text}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  commit({
                    ...data,
                    nodes: data.nodes.map((n) =>
                      n.id === node.id ? { ...n, text: e.target.value } : n,
                    ),
                  })
                }
              />
            )}
            {node.type === "file" && (
              <div className="canvas-file-content">
                <FileCard file={node.file} index={index} onOpen={onOpen} />
              </div>
            )}
            {node.type === "link" && (
              <button
                className="canvas-link"
                onClick={() => api().openExternal(node.url)}
              >
                <ArrowUpRight size={24} />
                {node.url}
              </button>
            )}
            {node.type === "group" && (
              <input
                aria-label="Название группы"
                className="group-label"
                value={node.label || ""}
                onChange={(e) =>
                  commit({
                    ...data,
                    nodes: data.nodes.map((n) =>
                      n.id === node.id ? { ...n, label: e.target.value } : n,
                    ),
                  })
                }
              />
            )}
            <div
              className="canvas-resize"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                undo.current.push(contentRef.current);
                drag.current = {
                  kind: "resize",
                  id: node.id,
                  x: e.clientX,
                  y: e.clientY,
                  width: node.width,
                  height: node.height,
                };
              }}
            />
          </div>
        ))}
      </div>
      <div className="canvas-controls">
        <span>
          {plural(data.nodes.length, ["карточка", "карточки", "карточек"])} ·{" "}
          {plural(data.edges.length, ["связь", "связи", "связей"])}
        </span>
        <button
          title="Уменьшить"
          onClick={() =>
            setTransform((t) => ({
              ...t,
              scale: Math.max(0.12, (t.scale / 0.85) * 0.72),
            }))
          }
        >
          <ZoomOut size={17} />
        </button>
        <span>{Math.round(transform.scale * 100)}%</span>
        <button
          title="Увеличить"
          onClick={() =>
            setTransform((t) => ({
              ...t,
              scale: Math.min(2.5, t.scale * 1.18),
            }))
          }
        >
          <ZoomIn size={17} />
        </button>
        <button title="Показать весь холст" onClick={fit}>
          <Maximize size={17} />
        </button>
      </div>
    </div>
  );
}
function PanelsIcon() {
  return (
    <div className="canvas-empty-symbol">
      <span />
      <span />
      <span />
      <i />
    </div>
  );
}
