import { expect, test } from "vitest";
import { parse } from "yaml";
import { displayBaseValue } from "../shared/base-display";
import { conditionExpression, writeBaseDocument } from "../shared/base-document";
import {
  removeBaseFormula,
  renameBaseFormula,
  renameFormulaReferences,
} from "../shared/base-formulas";
import { baseQuery } from "../shared/base-query";
import { BaseDuration, BaseLink, createBaseEnvironment } from "../shared/base-values";
import { evaluateExpression, rowEvaluator } from "../shared/bases";
import { indexNote } from "../shared/markdown";
import type { FileEntry } from "../shared/types";

test("формулы используют регулярные выражения без путаницы с делением, списки сворачиваются через acc", () => {
  expect(evaluateExpression('"a:b:c".replace(":", "-")', {})).toBe("a-b-c");
  expect(
    evaluateExpression(String.raw`"a1 b2".replace(/([a-z])(\d)/g, "$2$1")`, {}),
  ).toBe("1a 2b");
  expect(evaluateExpression(String.raw`/a\/b/.matches("a/b")`, {})).toBe(true);
  expect(evaluateExpression("12 / 3 + 2", {})).toBe(6);
  expect(evaluateExpression("[1,2,3].reduce(acc + value * 2, 0)", {})).toBe(12);
  expect(evaluateExpression("[3,12,2].sort()", {})).toEqual([2, 3, 12]);
  expect(evaluateExpression('"привет мир".title().reverse()', {})).toBe("риМ тевирП");
  expect(evaluateExpression('"a,b,c,d".split(/,/, 3)', {})).toEqual(["a", "b", "c"]);
  expect(
    evaluateExpression("note.data.keys().sort()", { note: { data: { z: 1, a: 2 } } }),
  ).toEqual(["a", "z"]);
});
test("календарная арифметика сохраняет конец месяца, длительности масштабируются и сравниваются", () => {
  expect(evaluateExpression('(date("2024-01-31") + "1M").format("YYYY-MM-DD")', {})).toBe(
    "2024-02-29",
  );
  expect(
    evaluateExpression('(date("2024-12-01") + "1 year").format("YYYY-MM-DD")', {}),
  ).toBe("2025-12-01");
  expect(evaluateExpression('number(date("2026-01-02") - date("2026-01-01"))', {})).toBe(
    86400000,
  );
  expect(evaluateExpression('duration("1h 30m") * 2', {})).toEqual(
    new BaseDuration(10800000),
  );
});
test("свойства ссылок, файлы, this и обратные ссылки разделены по типам", () => {
  const a = indexNote(
      "Работа/А.md",
      '---\nauthor: "[[Б]]"\nwebsite: https://example.com\n---\n[[Б]]',
    ),
    b = indexNote("Б.md", "---\nstatus: ready\n---\n# Б");
  const files: FileEntry[] = [
    { path: a.path, name: "А.md", kind: "note", size: 100, modified: 1000 },
    { path: b.path, name: "Б.md", kind: "note", size: 20, modified: 2000 },
  ];
  const environment = createBaseEnvironment([a, b], files, a.path);
  const row = rowEvaluator(a, files[0], [a, b], {}, { environment, thisPath: b.path });
  expect(row.evaluate("file.name")).toBe("А.md");
  expect(row.evaluate("file.basename")).toBe("А");
  expect(
    row.evaluate('author.isType("link") && author.asFile().hasProperty("status")'),
  ).toBe(true);
  expect(row.evaluate("author == this.file")).toBe(true);
  expect(row.evaluate('website.isType("url") && website.contains("example")')).toBe(true);
  expect(row.evaluate("this.file.backlinks.map(value.basename)")).toEqual(["А"]);
  expect(row.get("author")).toBeInstanceOf(BaseLink);
  expect(displayBaseValue(row.evaluate('file.asLink(icon("star"))'))).toMatchObject({
    kind: "link",
    resolved: a.path,
    label: { kind: "icon", name: "star" },
  });
});
test("постраничный результат считает итоги по всем строкам и возвращает значения только страницы", () => {
  const notes = Array.from({ length: 450 }, (_, i) =>
    indexNote(`n${i}.md`, `---\nvalue: ${i}\nstatus: ${i % 2 ? "done" : "todo"}\n---\n`),
  );
  const files: FileEntry[] = notes.map((note) => ({
    path: note.path,
    name: note.path,
    kind: "note",
    size: 20,
    modified: 0,
  }));
  const query = baseQuery({
    index: notes,
    files,
    document: {},
    view: { summaries: { value: "Sum" } },
    columns: ["file.name", "value"],
    filter: "",
    sort: "value",
    ascending: true,
    path: "n0.md",
  });
  const page = query.page(200, 200);
  expect(page.order).toHaveLength(450);
  expect(page.values).toHaveLength(200);
  expect(page.values[0].path).toBe("n200.md");
  expect(page.summaries.value).toBe((449 * 450) / 2);
  expect(page.groupCounts).toMatchObject({ done: 225, todo: 225 });
});
test("общий бюджет срабатывает до накопления больших результатов в кэше формул", () => {
  const notes = Array.from({ length: 50 }, (_, i) => indexNote(`n${i}.md`, "# N"));
  const files: FileEntry[] = notes.map((note) => ({
    path: note.path,
    name: note.path,
    kind: "note",
    size: 20,
    modified: 0,
  }));
  expect(() =>
    baseQuery({
      index: notes,
      files,
      document: {
        formulas: { large: '"x".repeat(1048576)' },
        filters: 'formula.large.contains("x")',
      },
      view: {},
      columns: ["file.name"],
      filter: "",
      sort: null,
      ascending: true,
      path: "n0.md",
    }),
  ).toThrow(/32 МиБ/);
});

test("настройки базы сохраняют YAML-комментарии и переименовывают только ссылки на формулу", () => {
  const source =
    '# Проекты\ncustom: keep # неизвестное поле\nformulas:\n  total: price * count # расчёт\n  label: formula.total + "formula.total"\nviews:\n  - name: Работа # представление\n    type: table\n    order: [file.name, formula.total]\n    columnSize: {formula.total: 250}\n    summaries: {formula.total: Sum}\n';
  const original = parse(source),
    renamed = renameBaseFormula(original, "total", "итог"),
    output = writeBaseDocument(source, renamed);
  expect(output).toContain("# Проекты");
  expect(output).toContain("# неизвестное поле");
  expect(output).toContain("# представление");
  expect(parse(output).custom).toBe("keep");
  expect(parse(output).views[0].order).toEqual(["file.name", "formula.итог"]);
  expect(renamed.formulas.label).toContain('"formula.total"');
  expect(
    renameFormulaReferences(
      'formula.total + /formula.total/.matches("formula.total")',
      "total",
      "new name",
    ),
  ).toContain('formula["new name"]');
  expect(() => removeBaseFormula(original, "total")).toThrow(/label/);
  expect(conditionExpression("note.unit price", ">", "12", "number")).toBe(
    'note["unit price"] > 12',
  );
});

test("календарные даты и свойства используют местную полночь, временные метки сохраняют свой часовой пояс", () => {
  const date = evaluateExpression('date("2026-11-12")', {}) as Date;
  expect(date.getHours()).toBe(0);
  expect(evaluateExpression('date("2026-11-12").format("YYYY-MM-DD")', {})).toBe(
    "2026-11-12",
  );
  expect(Number(evaluateExpression('date("2026-11-12T00:00:00Z")', {}))).toBe(
    Date.parse("2026-11-12T00:00:00Z"),
  );
  const note = indexNote("N.md", "---\ndue: 2026-11-12\n---\n"),
    file: FileEntry = {
      path: note.path,
      name: note.path,
      kind: "note",
      size: 20,
      modified: 0,
    },
    row = rowEvaluator(note, file, [note], {}, { types: { due: "date" } });
  expect(row.evaluate('due == date("2026-11-12")')).toBe(true);
  expect(() => evaluateExpression('date("2026-02-30")', {})).toThrow("дат");
});
