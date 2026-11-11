import { describe, expect, it } from "vitest";
import { evaluateExpression, matchesFilter, rowEvaluator } from "../shared/bases";
import { indexNote } from "../shared/markdown";
describe("Выражения Bases", () => {
  it("поддерживает арифметику, сравнения и условные выражения", () => {
    expect(
      evaluateExpression('if(price, (price / count).toFixed(2), "нет")', {
        note: { price: 15, count: 2 },
      }),
    ).toBe("7.50");
    expect(
      evaluateExpression('if(price, missing.toFixed(2), "нет")', {
        note: { price: 0 },
      }),
    ).toBe("нет");
  });
  it("обрабатывает вложенные фильтры, теги и папки", () => {
    const note = indexNote(
        "Проекты/Дело.md",
        "---\nstatus: open\nprice: 20\ntags: [проект/личный]\n---\n# Дело",
      ),
      e = rowEvaluator(note, undefined, [note]);
    expect(
      matchesFilter(
        {
          and: [
            'status != "done"',
            "price > 10",
            'file.inFolder("Проекты")',
            'file.hasTag("проект")',
          ],
        },
        e.evaluate,
      ),
    ).toBe(true);
    expect(matchesFilter({ not: ['file.hasTag("проект")'] }, e.evaluate)).toBe(false);
  });
  it("вычисляет зависимости формул и обнаруживает циклы", () => {
    const note = indexNote("a.md", "---\nprice: 10\ncount: 2\n---");
    expect(
      rowEvaluator(note, undefined, [note], {
        total: "price * count",
        label: 'formula.total.toFixed(1) + " руб."',
      }).get("formula.label"),
    ).toBe("20.0 руб.");
    expect(() =>
      rowEvaluator(note, undefined, [note], {
        a: "formula.b",
        b: "formula.a",
      }).get("formula.a"),
    ).toThrow("Цикл");
  });
  it.each([
    'note.constructor.constructor("return process")()',
    'file["__proto__"]',
    "globalThis.process",
    'fetch("https://example.com")',
    "note.price = 99",
    '[].constructor.constructor("return 1")()',
  ])("не исполняет JavaScript: %s", (expression) => {
    let rejected = false;
    let result: unknown;
    try {
      result = evaluateExpression(expression, { note: { price: 2 } });
    } catch {
      rejected = true;
    }
    expect(rejected || result === null).toBe(true);
  });
  it("обрабатывает списки, строки и даты", () => {
    expect(
      evaluateExpression('tags.unique().join(", ")', {
        note: { tags: ["a", "a", "b"] },
      }),
    ).toBe("a, b");
    expect(
      evaluateExpression('title.lower().contains("идея")', {
        note: { title: "Идея" },
      }),
    ).toBe(true);
    expect(evaluateExpression('date("2026-11-11").format("YYYY-MM-DD")', {})).toBe(
      "2026-11-11",
    );
  });
});
