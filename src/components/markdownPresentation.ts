const textOf = (node: any): string =>
  typeof node.value === "string"
    ? node.value
    : (node.children || []).map(textOf).join("");
const names: Record<string, string> = {
  note: "Заметка",
  abstract: "Кратко",
  summary: "Кратко",
  info: "Информация",
  todo: "Задача",
  tip: "Совет",
  hint: "Совет",
  success: "Готово",
  check: "Готово",
  question: "Вопрос",
  help: "Вопрос",
  warning: "Внимание",
  caution: "Внимание",
  failure: "Ошибка",
  danger: "Осторожно",
  bug: "Ошибка",
  example: "Пример",
  quote: "Цитата",
};
/** Semantic callouts/highlights/comments; raw note HTML remains disabled. */
export function markdownPresentation() {
  return (tree: any) => {
    function walk(node: any) {
      if (!node.children || ["code", "inlineCode", "html"].includes(node.type)) return;
      if (node.type === "blockquote") {
        const paragraph = node.children[0],
          first = paragraph?.children?.[0];
        const marker =
          first?.type === "text" && /^\[!([\w-]+)\]([+-])?[ \t]*/.exec(first.value);
        if (marker) {
          const kind = marker[1].toLowerCase(),
            titleNodes: any[] = [],
            bodyNodes: any[] = [];
          let inBody = false;
          for (const original of paragraph.children) {
            const child =
              original === first
                ? { ...original, value: original.value.slice(marker[0].length) }
                : original;
            if (inBody) {
              bodyNodes.push(child);
              continue;
            }
            const newline = child.type === "text" ? child.value.indexOf("\n") : -1;
            if (newline >= 0) {
              titleNodes.push({ ...child, value: child.value.slice(0, newline) });
              if (child.value.slice(newline + 1))
                bodyNodes.push({ ...child, value: child.value.slice(newline + 1) });
              inBody = true;
            } else titleNodes.push(child);
          }
          const title = textOf({ children: titleNodes }).trim() || names[kind] || kind;
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              "data-callout": kind,
              "data-callout-fold": marker[2] || "",
              "data-callout-title": title,
            },
          };
          if (bodyNodes.length) paragraph.children = bodyNodes;
          else node.children.shift();
        }
      }
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== "text") {
          walk(child);
          return [child];
        }
        const parts: any[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(/%%[^]*?%%|==([^=\n]+)==/g)) {
          if (match.index! > offset)
            parts.push({ type: "text", value: child.value.slice(offset, match.index) });
          if (match[1])
            parts.push({
              type: "emphasis",
              data: { hName: "mark" },
              children: [{ type: "text", value: match[1] }],
            });
          offset = match.index! + match[0].length;
        }
        if (offset < child.value.length)
          parts.push({ ...child, value: child.value.slice(offset) });
        return parts.length || offset ? parts : [child];
      });
    }
    walk(tree);
  };
}
export function markdownTaskPositions() {
  return (tree: any, file: any) => {
    const source = String(file.value || "");
    const walk = (node: any) => {
      if (node.type === "listItem" && typeof node.checked === "boolean") {
        const start = node.position?.start?.offset || 0,
          marker = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]/.exec(
            source.slice(start, start + 200),
          );
        if (marker)
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              "data-task-offset": start + marker[0].lastIndexOf("[") + 1,
              "data-task-label":
                textOf(
                  node.children?.find((child: any) => child.type === "paragraph") || node,
                )
                  .trim()
                  .slice(0, 200) || "Задача",
            },
          };
      }
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
  };
}
export function readingHighlights(query: string) {
  return () => (tree: any) => {
    if (!query) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      expression = new RegExp(escaped, "giu");
    let count = 0;
    const walk = (node: any) => {
      if (
        !node.children ||
        ["script", "style", "svg", "math"].includes(node.tagName) ||
        node.properties?.className?.includes("katex")
      )
        return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== "text" || count >= 2000) {
          walk(child);
          return [child];
        }
        const parts = [];
        let offset = 0;
        for (const match of child.value.matchAll(expression)) {
          if (count++ >= 2000) break;
          if (match.index! > offset)
            parts.push({ type: "text", value: child.value.slice(offset, match.index) });
          parts.push({
            type: "element",
            tagName: "mark",
            properties: { "data-find-match": true },
            children: [{ type: "text", value: match[0] }],
          });
          offset = match.index! + match[0].length;
        }
        if (offset < child.value.length)
          parts.push({ type: "text", value: child.value.slice(offset) });
        return parts.length ? parts : [child];
      });
    };
    walk(tree);
  };
}
