import { GFM, parser } from "@lezer/markdown";
import { noteHeadings } from "./markdown-blocks";
const markdown = parser.configure(GFM);
export type SearchScope =
  "line" | "block" | "section" | "task" | "task-todo" | "task-done";
export interface TextRange {
  from: number;
  to: number;
  line: number;
}
function withLines(source: string, ranges: { from: number; to: number }[]): TextRange[] {
  let previous = 0,
    line = 1;
  return ranges
    .sort((a, b) => a.from - b.from)
    .map((range) => {
      for (let i = previous; i < range.from; i++) if (source[i] === "\n") line++;
      previous = range.from;
      return { ...range, line };
    });
}
export function searchRanges(source: string, scope: SearchScope): TextRange[] {
  const ranges: { from: number; to: number }[] = [];
  if (scope === "line") {
    let offset = 0;
    for (const line of source.split("\n")) {
      ranges.push({ from: offset, to: offset + line.length });
      offset += line.length + 1;
    }
  } else if (scope === "section") {
    const headings = noteHeadings(source);
    if (!headings.length || headings[0].from > 0)
      ranges.push({ from: 0, to: headings[0]?.from || source.length });
    for (let i = 0; i < headings.length; i++)
      ranges.push({
        from: headings[i].from,
        to:
          headings.find((entry, next) => next > i && entry.level <= headings[i].level)
            ?.from || source.length,
      });
  } else
    markdown.parse(source).iterate({
      enter(node) {
        if (scope.startsWith("task")) {
          if (node.name !== "Task") return;
          const marker = source.slice(node.from, node.from + 3).toLowerCase();
          if (
            scope === "task" ||
            (scope === "task-todo" ? marker === "[ ]" : marker === "[x]")
          )
            ranges.push({ from: node.from, to: node.to });
          return false;
        }
        if (
          /^(?:Paragraph|FencedCode|CodeBlock|ATXHeading[1-6]|SetextHeading[12]|Table|Task)$/.test(
            node.name,
          )
        ) {
          ranges.push({ from: node.from, to: node.to });
          return false;
        }
      },
    });
  return withLines(source, ranges);
}
export { literalRanges } from "./markdown-literals";
