import { expect, test } from "vitest";
import { evaluateExpression } from "../shared/bases";
import { parseProperty } from "../shared/properties";
import { coordinates, summarize } from "../shared/summaries";
test("типы свойств сохраняют числа, флажки, списки и календарные даты", () => {
  expect(parseProperty("3.5", "number")).toBe(3.5);
  expect(parseProperty("false", "checkbox")).toBe(false);
  expect(parseProperty("#один, #два, #один", "tags")).toEqual(["один", "два"]);
  expect(parseProperty("2024-02-29", "date")).toBe("2024-02-29");
  expect(() => parseProperty("2025-02-29", "date")).toThrow("дату");
  expect(() => parseProperty("Infinity", "number")).toThrow("число");
  expect(() => parseProperty("javascript:alert(1)", "url")).toThrow("Ссылка");
});
test("итоги учитывают пустые значения, флажки, даты и пользовательские формулы", () => {
  expect(summarize([1, 2, 3, 4, null], "Median")).toBe(2.5);
  expect(summarize([1, 2, null], "Average")).toBe(1.5);
  expect(summarize([1, null, ""], "Empty")).toBe(2);
  expect(summarize([true, false, true], "PercentChecked")).toBe("66.67%");
  expect(summarize(["2026-02-01", "2025-02-01"], "Earliest")).toBe("2025-02-01");
  expect(summarize([1, 2, 3], "double", { double: "values.sum() * 2" })).toBe(12);
  expect(() => summarize([], "bad")).toThrow("Неизвестный");
});
test("формулы со списками имеют локальные value/index и ограниченный бюджет", () => {
  expect(
    evaluateExpression("list([1,2,3,4]).filter(value > 2).map(value * 2).sum()", {}),
  ).toBe(14);
  expect(evaluateExpression("list([1,2]).map(index + value)", {})).toEqual([1, 3]);
  expect(evaluateExpression('date("2026-01-01") + duration("2d")', {})).toEqual(
    new Date("2026-01-03T00:00:00Z"),
  );
  expect(() => evaluateExpression("[1].map(value.constructor)", {})).toThrow(
    "Запрещённое",
  );
});
test("координаты проверяются до отображения, ноль допустим", () => {
  expect(coordinates(0, 0)).toEqual([0, 0]);
  expect(coordinates("55.75", "37.61")).toEqual([55.75, 37.61]);
  for (const point of [
    [null, 1],
    [91, 0],
    [1, 181],
    ["abc", 1],
    ["", 0],
  ])
    expect(coordinates(...(point as [unknown, unknown]))).toBeNull();
});
