import { expect, test } from "vitest";
import {
  leaves,
  normalizeSession,
  removePane,
  singlePane,
  updatePane,
  type PaneLayout,
} from "../shared/panes";
test("старые вкладки восстанавливаются в одной панели, отсутствующие пути удаляются", () => {
  const session = normalizeSession(
    { tabs: ["a.md", "b.md", "a.md"], active: "b.md" },
    new Set(["a.md"]),
  );
  expect(session.tabs).toEqual(["a.md"]);
  expect(session.layout).toEqual(singlePane("a.md"));
});
test("дерево сохраняет независимые режимы и фокус, закрытие поднимает соседа", () => {
  const layout: PaneLayout = {
    kind: "split",
    id: "root",
    direction: "row",
    ratio: 0.6,
    first: singlePane("a.md", "a"),
    second: { ...singlePane("b.md", "b"), mode: "read" },
  };
  const session = normalizeSession({
    tabs: ["a.md", "b.md"],
    active: "a.md",
    activePane: "b",
    layout,
  });
  expect(session.active).toBe("b.md");
  expect(leaves(session.layout!)[1].mode).toBe("read");
  const edited = updatePane(layout, "a", (node) => ({ ...node, path: "b.md" }));
  expect(leaves(edited).map((p) => p.path)).toEqual(["b.md", "b.md"]);
  expect(removePane(edited, "a")).toEqual({ ...singlePane("b.md", "b"), mode: "read" });
});
test("недоверенные раскладки ограничены по глубине, количеству и идентификаторам", () => {
  const bad = {
    kind: "split",
    id: "root",
    direction: "row",
    ratio: 0.5,
    first: singlePane(null),
    second: singlePane(null),
  };
  expect(() => normalizeSession({ tabs: [], layout: bad })).toThrow("идентификатор");
  let tree: PaneLayout = singlePane(null, "leaf");
  for (let i = 0; i < 10; i++)
    tree = {
      kind: "split",
      id: `s${i}`,
      direction: "row",
      ratio: 0.5,
      first: tree,
      second: singlePane(null, `l${i}`),
    };
  expect(() => normalizeSession({ tabs: [], layout: tree })).toThrow("структура");
});
