import { expect, test } from "vitest";
import { buildGraph, linkResolver } from "../shared/graph";
import { indexNote, resolveLink } from "../shared/markdown";
test("индекс ссылок сохраняет относительные пути, псевдонимы и приоритеты", () => {
  const notes = [
      indexNote("Папка/a.md", "---\naliases: [первый]\n---\n# A"),
      indexNote("a.md", "# A"),
      indexNote("b.md", "# B"),
    ],
    paths = notes.map((n) => n.path),
    resolve = linkResolver(paths, notes);
  for (const from of paths)
    for (const target of [
      "a",
      "A",
      "первый",
      "../b",
      "#заголовок",
      "Папка/a.md",
      "нет",
      "%D0%BF%D0%B5%D1%80%D0%B2%D1%8B%D0%B9",
    ])
      expect(resolve(target, from)).toBe(resolveLink(target, from, paths, notes));
});
test("граф не обрезает число заметок, локальный режим оставляет непосредственных соседей", () => {
  const notes = Array.from({ length: 6000 }, (_, i) =>
    indexNote(`n${i}.md`, `# n${i}\n[[n${(i + 1) % 6000}]]`),
  );
  const full = buildGraph(notes, "", false, "n0.md");
  expect(full.nodes).toHaveLength(6000);
  expect(full.edges).toHaveLength(6000);
  const local = buildGraph(notes, "", true, "n0.md");
  expect(local.nodes.map((n) => n.path).sort()).toEqual(["n0.md", "n1.md", "n5999.md"]);
});
