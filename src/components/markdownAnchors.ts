import { headingSlugger, noteHeadings } from "../../shared/markdown-blocks";

const textOf = (node: any): string =>
  typeof node.value === "string"
    ? node.value
    : (node.children || []).map(textOf).join("");

/** IDs are attached to parsed blocks; note HTML never becomes executable markup. */
export function markdownAnchors() {
  return (tree: any, file: { value?: unknown }) => {
    const sourceHeadings = new Map(
        noteHeadings(String(file.value || "")).map((heading) => [
          heading.line,
          heading.id,
        ]),
      ),
      slug = headingSlugger(),
      blocks = new Set<string>();
    const assign = (node: any, id: string) => {
      if (blocks.has(id)) return;
      blocks.add(id);
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, id: "block-" + id },
      };
    };
    const walk = (parent: any) => {
      if (!parent.children || ["code", "inlineCode", "html"].includes(parent.type))
        return;
      for (let i = 0; i < parent.children.length; i++) {
        const node = parent.children[i];
        walk(node);
        if (node.type === "heading") {
          const id = sourceHeadings.get(node.position?.start?.line) || slug(textOf(node));
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              id,
            },
          };
        }
        if (!["paragraph", "heading"].includes(node.type)) continue;
        const last = node.children?.at(-1);
        if (last?.type !== "text") continue;
        const match = /(?:^|\s)\^([\p{L}\p{N}_-]+)\s*$/u.exec(last.value);
        if (!match) continue;
        if (node.children.length === 1 && last.value.trim() === "^" + match[1]) {
          const previous = parent.children[i - 1];
          if (previous) {
            assign(previous, match[1]);
            parent.children.splice(i--, 1);
          }
        } else {
          last.value = last.value.slice(0, match.index);
          assign(parent.type === "listItem" ? parent : node, match[1]);
        }
      }
    };
    walk(tree);
  };
}
