import path from "node:path";
import { expect, test } from "vitest";
import { runSearch } from "../electron/search";
import { indexNote } from "../shared/markdown";
import { parseSearch, searchDocuments } from "../shared/search";
const document = (path: string, text: string) => ({ note: indexNote(path, text), text });
const docs = [
  document(
    "Работа/План.md",
    "---\ntags: [проект/а]\nstatus: active\nrating: 5\n---\n# План\nКрасный мост 42.",
  ),
  document("Личное/Дом.md", "---\nstatus: done\nrating: 2\n---\n# Дом\nСиний дом."),
  document("Архив.md", "# Архив\nКрасный мост."),
];
const find = (q: string) => [
  ...new Set(searchDocuments(docs, parseSearch(q)!).map((r) => r.path)),
];
test("поиск: приоритет AND/OR, группы, NOT и отрицание", () => {
  expect(find("(Красный OR Синий) -path:Архив")).toEqual([
    "Работа/План.md",
    "Личное/Дом.md",
  ]);
  expect(find("Красный AND NOT tag:проект")).toEqual(["Архив.md"]);
  expect(find('file:Дом OR path:Работа "Красный мост"')).toEqual([
    "Работа/План.md",
    "Личное/Дом.md",
  ]);
});
test("поиск: свойства, типизированные сравнения, Unicode regex и вложенные теги", () => {
  expect(find("[status: active] [rating:>=4] tag:#проект")).toEqual(["Работа/План.md"]);
  expect(find("[rating:<3] [status]")).toEqual(["Личное/Дом.md"]);
  expect(find("content:/мост \\d+/iu")).toEqual(["Работа/План.md"]);
  expect(find("title:/^дом$/i")).toEqual(["Личное/Дом.md"]);
});
test("ошибки запроса объясняются, содержимое не выполняется как код", () => {
  for (const query of ["foo OR", "(foo", '"foo', "/foo/g", "[status:", "foo)"])
    expect(() => parseSearch(query)).toThrow();
  expect(find("process.exit(1)")).toEqual([]);
});
test("зависшее регулярное выражение прерывается, следующий поиск работает", async () => {
  const worker = path.resolve("dist-electron/search-worker.cjs");
  const evil = [document("Длинная.md", "a".repeat(20000) + "!")];
  const start = Date.now();
  await expect(runSearch(worker, evil, "/(a+)+$/", undefined, 200)).rejects.toThrow(
    "слишком много времени",
  );
  expect(Date.now() - start).toBeLessThan(2000);
  expect(await runSearch(worker, docs, "[status:done]")).toMatchObject([
    { path: "Личное/Дом.md" },
  ]);
});
