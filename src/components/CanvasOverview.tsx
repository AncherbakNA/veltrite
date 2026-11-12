import { useEffect, useRef } from "react";
import type { CanvasData, CanvasNode } from "../../shared/types";
import { usePaletteVersion } from "../usePaletteVersion";
export default function CanvasOverview({
  data,
  transform,
  width,
  height,
  onActivate,
  onTransform,
}: {
  data: CanvasData;
  transform: { x: number; y: number; scale: number };
  width: number;
  height: number;
  onActivate: (node: CanvasNode) => void;
  onTransform: (transform: { x: number; y: number; scale: number }) => void;
}) {
  const paletteVersion = usePaletteVersion();
  const canvas = useRef<HTMLCanvasElement>(null),
    pointer = useRef({ x: 0, y: 0, transform });
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !canvas.current) return;
    const ratio = Math.min(2, window.devicePixelRatio);
    canvas.current.width = Math.round(width * ratio);
    canvas.current.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.translate(transform.x, transform.y);
    context.scale(transform.scale, transform.scale);
    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    const style = getComputedStyle(document.documentElement);
    context.strokeStyle = style.getPropertyValue("--border-strong");
    context.lineWidth = 1 / transform.scale;
    context.beginPath();
    for (const edge of data.edges) {
      const a = byId.get(edge.fromNode),
        b = byId.get(edge.toNode);
      if (a && b) {
        context.moveTo(a.x + a.width, a.y + a.height / 2);
        context.lineTo(b.x, b.y + b.height / 2);
      }
    }
    context.stroke();
    const palette: Record<string, string> = {
      "1": "#e27b84",
      "2": "#dea26f",
      "3": "#d9c176",
      "4": "#8fbe9b",
      "5": "#7cbcca",
      "6": "#b29aeb",
    };
    for (const node of data.nodes) {
      context.fillStyle = node.color
        ? palette[node.color] ||
          (/^#[\da-f]{6}$/i.test(node.color)
            ? node.color
            : style.getPropertyValue("--accent"))
        : style.getPropertyValue("--panel");
      context.globalAlpha = node.type === "group" ? 0.25 : 0.9;
      context.fillRect(node.x, node.y, node.width, node.height);
      context.strokeRect(node.x, node.y, node.width, node.height);
    }
    context.globalAlpha = 1;
  }, [data, transform, width, height, paletteVersion]);
  return (
    <canvas
      ref={canvas}
      className="canvas-overview"
      aria-label={`Обзор холста: ${data.nodes.length} карточек`}
      style={{ width, height }}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = { x: event.clientX, y: event.clientY, transform };
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const start = pointer.current;
        onTransform({
          ...start.transform,
          x: start.transform.x + event.clientX - start.x,
          y: start.transform.y + event.clientY - start.y,
        });
      }}
      onPointerUp={(event) => {
        if (
          Math.hypot(
            event.clientX - pointer.current.x,
            event.clientY - pointer.current.y,
          ) > 5
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect(),
          x = (event.clientX - rect.left - transform.x) / transform.scale,
          y = (event.clientY - rect.top - transform.y) / transform.scale;
        const node = data.nodes.findLast(
          (node) =>
            x >= node.x &&
            x <= node.x + node.width &&
            y >= node.y &&
            y <= node.y + node.height,
        );
        if (node) onActivate(node);
      }}
    />
  );
}
