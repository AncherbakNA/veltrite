import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { relativeLink } from "../shared/links";
import { resolveLink } from "../shared/markdown";
import { headingSlugger } from "../shared/markdown-blocks";
import type { NoteIndex } from "../shared/types";
export function noteCompletion(
  context: CompletionContext,
  data: { path: string; index: NoteIndex[]; paths: string[] },
): CompletionResult | null {
  let syntax = syntaxTree(context.state).resolveInner(context.pos, -1);
  for (let node: typeof syntax | null = syntax; node; node = node.parent)
    if (/Code/.test(node.name)) return null;
  const before = context.state.sliceDoc(
      context.state.doc.lineAt(context.pos).from,
      context.pos,
    ),
    wiki = /!?\[\[([^\]\n]*)$/.exec(before);
  if (wiki) {
    if (wiki[1].includes("|")) return null;
    const start = context.pos - wiki[1].length,
      fragmentAt = wiki[1].indexOf("#");
    const insert =
      (text: string) =>
      (
        view: import("@codemirror/view").EditorView,
        _completion: unknown,
        from: number,
        to: number,
      ) => {
        const close = view.state.sliceDoc(to, to + 2) === "]]";
        view.dispatch({
          changes: { from, to: to + (close ? 2 : 0), insert: text + "]]" },
          selection: { anchor: from + text.length + 2 },
          userEvent: "input.complete",
        });
      };
    if (fragmentAt >= 0) {
      const target = wiki[1].slice(0, fragmentAt),
        file = resolveLink(target, data.path, data.paths, data.index),
        note = data.index.find((note) => note.path === file);
      if (!note) return null;
      const slug = headingSlugger(),
        block = wiki[1].slice(fragmentAt + 1).startsWith("^");
      return {
        from: start + fragmentAt + 1,
        options: block
          ? (note.blocks || []).map((entry) => ({
              label: "^" + entry.id,
              type: "text",
              apply: insert("^" + entry.id),
              detail: "Блок",
            }))
          : note.headings.map((entry) => ({
              label: entry.text,
              type: "text",
              apply: insert(slug(entry.text)),
              detail: "Заголовок " + entry.level,
            })),
      };
    }
    const byPath = new Map(data.index.map((note) => [note.path, note]));
    return {
      from: start,
      options: data.paths
        .filter((path) => /\.(md|canvas|base)$/i.test(path))
        .slice(0, 50000)
        .flatMap((path) => {
          const note = byPath.get(path),
            target = relativeLink(data.path, path).replace(/\.md$/i, ""),
            title = note?.title || path.split("/").pop()!;
          return [
            { label: title, detail: path, type: "text", apply: insert(target) },
            ...(note?.aliases || []).map((alias) => ({
              label: alias,
              detail: path,
              type: "text",
              apply: insert(target + "|" + alias),
            })),
          ];
        }),
    };
  }
  const tag = /(?:^|\s)#([\p{L}\p{N}_/-]*)$/u.exec(before);
  if (tag)
    return {
      from: context.pos - tag[1].length,
      options: [...new Set(data.index.flatMap((note) => note.tags))].map((tag) => ({
        label: tag,
        type: "keyword",
      })),
    };
  const doc = context.state.doc,
    prefix = context.state.sliceDoc(0, context.pos);
  if (doc.line(1).text === "---" && !/^---\s*$/m.test(prefix.slice(4))) {
    const key = /^([\p{L}\p{N}_-]*)$/u.exec(before);
    if (key && key[1])
      return {
        from: context.pos - key[1].length,
        options: [
          ...new Set(data.index.flatMap((note) => Object.keys(note.properties))),
        ].map((name) => ({ label: name, apply: name + ": ", type: "property" })),
      };
  }
  return null;
}
