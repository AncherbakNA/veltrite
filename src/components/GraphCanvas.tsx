import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "../../shared/graph";
import { usePaletteVersion } from "../usePaletteVersion";
export default function GraphCanvas({
  graph,
  active,
  onOpen,
}: {
  graph: GraphData;
  active: string | null;
  onOpen: (path: string) => void;
}) {
  const paletteVersion = usePaletteVersion();
  const host = useRef<HTMLCanvasElement>(null),
    [size, setSize] = useState({ width: 1000, height: 660 }),
    [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 }),
    [hover, setHover] = useState<GraphNode | null>(null);
  const drag = useRef<{ x: number; y: number; transform: typeof transform } | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const bins = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const node of graph.nodes) {
      const key = `${Math.floor(node.x / 20)},${Math.floor(node.y / 20)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(node);
    }
    return map;
  }, [graph]);
  const unit = Math.min(size.width / 1000, size.height / 660),
    offset = { x: (size.width - 1000 * unit) / 2, y: (size.height - 660 * unit) / 2 };
  const hit = (clientX: number, clientY: number) => {
    const rect = host.current!.getBoundingClientRect(),
      x = ((clientX - rect.left - offset.x) / unit - transform.x) / transform.scale,
      y = ((clientY - rect.top - offset.y) / unit - transform.y) / transform.scale,
      radius = 10 / unit / transform.scale;
    let closest: GraphNode | null = null,
      distance = radius;
    for (
      let bx = Math.floor((x - radius) / 20);
      bx <= Math.floor((x + radius) / 20);
      bx++
    )
      for (
        let by = Math.floor((y - radius) / 20);
        by <= Math.floor((y + radius) / 20);
        by++
      )
        for (const node of bins.get(`${bx},${by}`) || []) {
          const delta = Math.hypot(node.x - x, node.y - y);
          if (delta < distance) {
            distance = delta;
            closest = node;
          }
        }
    return closest;
  };
  useEffect(() => {
    const canvas = host.current,
      context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio);
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, size.width, size.height);
    context.translate(offset.x + transform.x * unit, offset.y + transform.y * unit);
    context.scale(unit * transform.scale, unit * transform.scale);
    const style = getComputedStyle(document.documentElement),
      byPath = new Map(graph.nodes.map((node) => [node.path, node]));
    context.strokeStyle = style.getPropertyValue("--border-strong");
    context.lineWidth = 0.5 / Math.sqrt(transform.scale);
    context.globalAlpha = 0.45;
    context.beginPath();
    for (const edge of graph.edges) {
      const a = byPath.get(edge.from),
        b = byPath.get(edge.to);
      if (a && b) {
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
    }
    context.stroke();
    context.globalAlpha = 1;
    for (const node of graph.nodes) {
      context.fillStyle = style.getPropertyValue(
        node.path === active || node === hover ? "--accent" : "--muted",
      );
      context.beginPath();
      context.arc(
        node.x,
        node.y,
        (node === hover ? 5 : 2.2) / Math.sqrt(transform.scale),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }, [graph, active, hover, size, transform, unit, offset.x, offset.y, paletteVersion]);
  return (
    <div className="graph-canvas-wrap">
      <canvas
        ref={host}
        className="graph-canvas"
        aria-label={`Граф: ${graph.nodes.length} заметок`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "0") setTransform({ x: 0, y: 0, scale: 1 });
        }}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, transform };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start)
            setTransform({
              ...start.transform,
              x: start.transform.x + (event.clientX - start.x) / unit,
              y: start.transform.y + (event.clientY - start.y) / unit,
            });
          else setHover(hit(event.clientX, event.clientY));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) {
            const node = hit(event.clientX, event.clientY);
            if (node) onOpen(node.path);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect(),
            x = (event.clientX - rect.left - offset.x) / unit,
            y = (event.clientY - rect.top - offset.y) / unit,
            scale = Math.min(
              40,
              Math.max(0.3, transform.scale * Math.exp(-event.deltaY * 0.002)),
            );
          setTransform({
            scale,
            x: x - ((x - transform.x) * scale) / transform.scale,
            y: y - ((y - transform.y) * scale) / transform.scale,
          });
        }}
      />
      <button
        className="graph-fit"
        onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
      >
        Показать всё
      </button>
      {hover && <div className="graph-hover">{hover.title}</div>}
    </div>
  );
}
