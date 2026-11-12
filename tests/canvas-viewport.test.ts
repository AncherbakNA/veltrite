import { expect, test } from "vitest";
import { canvasVisibility, viewport } from "../shared/canvas-viewport";
import type { CanvasData } from "../shared/types";
test("виртуализация оставляет видимые и выбранные карточки, а также пересекающие экран связи", () => {
  const data: CanvasData = {
    nodes: [
      { id: "a", type: "text", text: "a", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", type: "text", text: "b", x: 10000, y: 0, width: 100, height: 100 },
      { id: "c", type: "text", text: "c", x: -10000, y: 0, width: 100, height: 100 },
    ],
    edges: [{ id: "edge", fromNode: "b", toNode: "c" }],
  };
  const result = canvasVisibility(
    data,
    viewport({ x: 0, y: 0, scale: 1 }, 800, 600, 0),
    new Set(["b"]),
  );
  expect(result.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect(result.edges.map((e) => e.id)).toEqual(["edge"]);
  expect(data.nodes.length).toBe(3);
});
