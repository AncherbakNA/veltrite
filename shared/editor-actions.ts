export const editorActions: Record<string, string> = {
  fold: "Свернуть разделы",
  unfold: "Развернуть разделы",
  bold: "Жирный",
  italic: "Курсив",
  strike: "Зачёркнутый",
  highlight: "Выделение цветом",
  code: "Встроенный код",
  link: "Вставить ссылку",
  wiki: "Вставить внутреннюю ссылку",
  image: "Вставить изображение",
  quote: "Цитата",
  callout: "Выноска",
  bullet: "Маркированный список",
  ordered: "Нумерованный список",
  task: "Переключить задачу",
  codeblock: "Блок кода",
  math: "Формула",
  mermaid: "Диаграмма",
  table: "Вставить таблицу",
  rule: "Горизонтальная линия",
  comment: "Комментарий",
  "heading-1": "Заголовок 1",
  "heading-2": "Заголовок 2",
  "heading-3": "Заголовок 3",
  "heading-4": "Заголовок 4",
  "heading-5": "Заголовок 5",
  "heading-6": "Заголовок 6",
};
export function editorAction(
  content: string,
  from: number,
  to: number,
  action: string,
): { from: number; to: number; insert: string; anchor: number; head: number } {
  const selected = content.slice(from, to);
  const inline = (
    {
      bold: "**",
      italic: "*",
      strike: "~~",
      highlight: "==",
      code: "`",
      comment: "%%",
    } as Record<string, string>
  )[action];
  if (inline) {
    if (
      selected.startsWith(inline) &&
      selected.endsWith(inline) &&
      selected.length >= inline.length * 2
    )
      return {
        from,
        to,
        insert: selected.slice(inline.length, -inline.length),
        anchor: from,
        head: to - inline.length * 2,
      };
    if (
      content.slice(Math.max(0, from - inline.length), from) === inline &&
      content.slice(to, to + inline.length) === inline
    )
      return {
        from: from - inline.length,
        to: to + inline.length,
        insert: selected,
        anchor: from - inline.length,
        head: to - inline.length,
      };
    return {
      from,
      to,
      insert: inline + selected + inline,
      anchor: from + inline.length,
      head: to + inline.length,
    };
  }
  const wrapping = (
    {
      link: ["[", "](https://)"],
      wiki: ["[[", "]]"],
      image: ["![", "](https://)"],
      codeblock: ["\n```\n", "\n```\n"],
      math: ["\n$$\n", "\n$$\n"],
      mermaid: ["\n```mermaid\n", "\n```\n"],
    } as Record<string, [string, string]>
  )[action];
  if (wrapping)
    return {
      from,
      to,
      insert: wrapping[0] + selected + wrapping[1],
      anchor: from + wrapping[0].length,
      head: to + wrapping[0].length,
    };
  if (action === "table" || action === "rule") {
    const insert =
      action === "rule"
        ? "\n\n---\n\n"
        : "\n| Заголовок | Значение |\n| --- | --- |\n|  |  |\n";
    return { from, to, insert, anchor: from + insert.length, head: from + insert.length };
  }
  const start = content.lastIndexOf("\n", from - 1) + 1,
    end = content.indexOf("\n", Math.max(from, to - 1)),
    until = end < 0 ? content.length : end;
  const lines = content.slice(start, until).split("\n");
  const strip = (line: string) =>
    line.replace(/^(\s*)(?:(?:[-+*]|\d+\.)\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)/, "$1");
  const prefix = action.startsWith("heading-")
    ? "#".repeat(Number(action.at(-1))) + " "
    : action === "quote"
      ? "> "
      : action === "bullet"
        ? "- "
        : "";
  const allMarked = prefix && lines.every((line) => line.startsWith(prefix));
  const insert = lines
    .map((line, i) => {
      if (action === "task") {
        const task = /^(\s*[-+*]\s+)\[([ xX])\](.*)$/.exec(line);
        return task
          ? task[1] + (task[2] === " " ? "[x]" : "[ ]") + task[3]
          : line.replace(
              /^(\s*)(.*)$/,
              (_, indent, value) => indent + "- [ ] " + strip(value),
            );
      }
      if (action === "callout") return i === 0 ? "> [!note]\n> " + line : "> " + line;
      if (action === "ordered") return i + 1 + ". " + strip(line);
      return allMarked ? line.slice(prefix.length) : prefix + strip(line);
    })
    .join("\n");
  return { from: start, to: until, insert, anchor: start, head: start + insert.length };
}
