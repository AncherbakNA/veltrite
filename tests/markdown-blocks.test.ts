import { describe, expect, it } from "vitest";
import {
  decodeFragment,
  findHeading,
  headingId,
  noteFragment,
  noteHeadings,
  referenceBlocks,
  renderedBlocks,
  tableCells,
} from "../shared/markdown-blocks";

describe("Блоки Markdown", () => {
  it("распознаёт закрытые таблицы, формулы и диаграммы, сохраняя исходные диапазоны", () => {
    const source =
      "# Проверка\n\n| A | B |\n| --- | :---: |\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n```mermaid\ngraph LR\nA-->B\n```\n";
    const blocks = renderedBlocks(source);
    expect(blocks.map((block) => block.kind)).toEqual(["table", "math", "mermaid"]);
    for (const block of blocks)
      expect(source.slice(block.from, block.to)).toBe(block.source);
  });
  it("не превращает фрагменты кода и незакрытые выражения в виджеты", () => {
    expect(renderedBlocks("```md\n| A | B |\n| --- | --- |\n$$x$$\n```\n")).toEqual([]);
    expect(renderedBlocks("```mermaid\nA-->B")).toEqual([]);
    expect(renderedBlocks("$$\nx^2")).toEqual([]);
    expect(tableCells("| a \\| b | `c|d` | e |")).toEqual(["a \\| b", "`c|d`", "e"]);
  });
  it("находит абзацы, списки и многострочный код по ID блока", () => {
    const source =
      "---\ntags: [справка]\n---\n# Тест\nАбзац\nна двух строках ^first\n\n- пункт ^item\n\n```js\na()\n\nb()\n```\n\n^code\n";
    expect(referenceBlocks(source).map((block) => [block.id, block.text])).toEqual([
      ["first", "Абзац\nна двух строках"],
      ["item", "- пункт"],
      ["code", "```js\na()\n\nb()\n```"],
    ]);
    expect(noteFragment(source, "Тест#^first")).toBe("Абзац\nна двух строках");
    expect(noteFragment(source, "#^missing")).toBeNull();
  });
  it("ограничивает раздел до следующего заголовка того же уровня", () => {
    expect(noteFragment("# A\n\n## B\nТекст\n### C\nЕщё\n## D\nКонец", "#B")).toBe(
      "## B\nТекст\n### C\nЕщё",
    );
    expect(headingId("**Заголовок** с [[Заметка|ссылкой]]")).toBe("заголовок-с-ссылкой");
  });
});

it("адреса дубликатов уникальны, закодированные ссылки и встраивание используют те же ID", () => {
  const source =
    "---\ntitle: Проверка\n---\n# Раздел\nОдин\n# Раздел\nДва\n# Раздел-2\nТри\n# Раздел\nЧетыре\n\n```md\n# Раздел\n```\n";
  const headings = noteHeadings(source);
  expect(headings.map((item) => item.id)).toEqual([
    "раздел",
    "раздел-2",
    "раздел-2-2",
    "раздел-3",
  ]);
  expect(
    findHeading(
      headings,
      decodeFragment("Заметка#%D1%80%D0%B0%D0%B7%D0%B4%D0%B5%D0%BB-2"),
    )?.line,
  ).toBe(6);
  expect(noteFragment(source, "#раздел-2")).toBe("# Раздел\nДва");
  expect(noteFragment(source, "#раздел-2-2")).toBe("# Раздел-2\nТри");
  expect(noteHeadings("Заголовок\n===\n\nПодзаголовок\n---").map((h) => h.level)).toEqual(
    [1, 2],
  );
});
