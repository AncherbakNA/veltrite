import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import { mapBookmarks } from "../shared/bookmarks";
import { rewriteCanvasReferences } from "../shared/canvas-references";
import { planMovedFragments } from "../shared/compose-fragments";
import type { ComposeRequest, ComposeResult } from "../shared/composer";
import { relativeLink } from "../shared/links";
import { frontmatter } from "../shared/markdown";
import type { NoteData } from "../shared/types";
import { relativePath, safePath } from "./paths";
import { rewriteMarkdownLinks } from "./rename-links";
import { Vault } from "./vault";

function combine(
  target: string,
  source: string,
  placement: "append" | "prepend",
): string {
  const own = frontmatter(target),
    other = frontmatter(source);
  if (/^---\r?\n/.test(source) && other.body === source)
    throw Error("Исправьте YAML-свойства перед объединением");
  const header = /^---\r?\n([^]*?)\r?\n---(?:\r?\n|$)/.exec(target);
  if (/^---\r?\n/.test(target) && !header)
    throw Error("Исправьте YAML-свойства перед объединением");
  const doc = parseDocument(header?.[1] || "");
  doc.toJS({ maxAliasCount: 30 });
  if (doc.errors.length) throw Error("Исправьте YAML-свойства перед объединением");
  for (const [key, value] of Object.entries(other.properties)) {
    if (!doc.has(key)) doc.set(key, value);
    else if (["tags", "aliases"].includes(key)) {
      const left = own.properties[key];
      doc.set(key, [
        ...new Set([
          ...(Array.isArray(left) ? left : left == null ? [] : [left]),
          ...(Array.isArray(value) ? value : value == null ? [] : [value]),
        ]),
      ]);
    } else if (JSON.stringify(own.properties[key]) !== JSON.stringify(value)) {
      // Never silently discard conflicting source metadata.
      let name = key + "_из_источника";
      while (doc.has(name)) name += "_2";
      doc.set(name, value);
    }
  }
  const body =
    placement === "append"
      ? [own.body.trimEnd(), other.body.trim()]
      : [other.body.trim(), own.body.trimStart()];
  return (
    (doc.contents ? "---\n" + doc.toString().trimEnd() + "\n---\n" : "") +
    body.filter(Boolean).join("\n\n") +
    "\n"
  );
}

/** Serialize with other vault writes. Revisions protect both the forward operation and rollback. */
export async function composeNotes(
  vault: Vault,
  request: ComposeRequest,
): Promise<ComposeResult> {
  if (
    !request ||
    !["extract", "merge"].includes(request.operation) ||
    !["append", "prepend"].includes(request.placement) ||
    !["link", "embed", "none"].includes(request.replacement)
  )
    throw Error("Некорректная операция с заметками");
  relativePath(request.source);
  relativePath(request.target);
  if (
    !/\.md$/i.test(request.source) ||
    !/\.md$/i.test(request.target) ||
    request.source.normalize("NFC").toLocaleLowerCase() ===
      request.target.normalize("NFC").toLocaleLowerCase()
  )
    throw Error("Выберите другую текстовую заметку");
  const source = await vault.read(request.source);
  if (source.revision !== request.sourceRevision)
    throw Error("Исходная заметка изменилась. Повторите перенос");
  const index = await vault.index(),
    files = await vault.list(),
    paths = files.filter((entry) => entry.kind !== "folder").map((entry) => entry.path);
  let target: NoteData | null = null;
  try {
    target = await vault.read(request.target);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  if (target && target.revision !== request.targetRevision)
    throw Error("Целевая заметка изменилась. Повторите перенос");
  if (!target && request.targetRevision) throw Error("Целевая заметка была удалена");
  if (!target) await vault.assertUnique(request.target);
  const edits: { before: NoteData | null; path: string; content: string }[] = [];
  let content = source.content;
  if (request.operation === "extract") {
    const { from, to } = request;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from! < 0 ||
      to! <= from! ||
      to! > content.length
    )
      throw Error("Сначала выделите текст в редакторе");
    const metadataLength = content.length - frontmatter(content).body.length;
    if (from! < metadataLength)
      throw Error(
        "Свойства YAML извлекаются вместе с заметкой, выделите текст ниже свойств",
      );
    content = content.slice(from, to);
    const link =
      request.replacement === "embed"
        ? `![[${relativeLink(request.source, request.target)}]]`
        : `[${request.target
            .split("/")
            .pop()!
            .replace(/\.md$/i, "")
            .replace(
              /[\\[\]]/g,
              "\\$&",
            )}](${relativeLink(request.source, request.target)})`;
    edits.push({
      before: source,
      path: source.path,
      content:
        source.content.slice(0, from) +
        (request.replacement === "none" ? "" : link) +
        source.content.slice(to),
    });
  }
  const fragments = planMovedFragments(
    content,
    target?.content || "",
    source.content,
    request.operation === "extract" ? request.from : 0,
  );
  const anchors = {
    source: source.path,
    target: request.target,
    fragment: fragments.remap,
  };
  const moved = rewriteMarkdownLinks(
    fragments.content,
    source.path,
    request.target,
    request.operation === "merge" ? source.path : "",
    request.target,
    false,
    paths,
    index,
    anchors,
  );
  edits.unshift({
    before: target,
    path: request.target,
    content: target ? combine(target.content, moved, request.placement) : moved,
  });
  {
    for (const note of index) {
      if (note.path === source.path && request.operation === "merge") continue;
      const data = note.path === target?.path ? target : await vault.read(note.path);
      const pending = edits.find((edit) => edit.path === data.path);
      const text = pending?.content || data.content;
      const updated = rewriteMarkdownLinks(
        text,
        data.path,
        data.path,
        request.operation === "merge" ? source.path : "",
        request.target,
        false,
        paths,
        index,
        anchors,
      );
      if (pending) pending.content = updated;
      else if (updated !== text)
        edits.push({ before: data, path: data.path, content: updated });
    }
    for (const file of files.filter((file) => file.kind === "canvas")) {
      const data = await vault.read(file.path);
      const updated = rewriteCanvasReferences(
        data.content,
        data.path,
        data.path,
        request.operation === "merge" ? source.path : "",
        request.target,
        false,
        paths,
        index,
        anchors,
      );
      if (updated !== data.content)
        edits.push({ before: data, path: data.path, content: updated });
    }
    if (request.operation === "merge" && request.replacement !== "none")
      edits.push({
        before: source,
        path: source.path,
        content:
          request.replacement === "embed"
            ? `![[${relativeLink(source.path, request.target)}]]\n`
            : `[${request.target.split("/").pop()!.replace(/\.md$/i, "")}](${relativeLink(source.path, request.target)})\n`,
      });
  }
  if (
    edits.reduce(
      (sum, edit) =>
        sum +
        Buffer.byteLength(edit.content) +
        Buffer.byteLength(edit.before?.content || ""),
      0,
    ) >
    128 * 1024 * 1024
  )
    throw Error(
      "Объём переноса и обратных ссылок больше 128 МиБ. Разделите операцию на части",
    );
  const previousPreferences = structuredClone(vault.preferences),
    bookmarkItems = mapBookmarks(previousPreferences.bookmarkItems, (item) => {
      if (
        item.type === "graph" &&
        item.local === source.path &&
        request.operation === "merge"
      )
        return { ...item, local: request.target };
      if (item.type !== "file" || item.path !== source.path) return item;
      const fragment = item.fragment ? fragments.remap(item.fragment) : null;
      return request.operation === "merge" || fragment !== null
        ? { ...item, path: request.target, ...(fragment !== null ? { fragment } : {}) }
        : item;
    });
  const preferencesChanged =
    JSON.stringify(bookmarkItems) !== JSON.stringify(previousPreferences.bookmarkItems);
  let preferencesWritten = false;
  const written: { edit: (typeof edits)[number]; revision: string }[] = [];
  try {
    for (const edit of edits) {
      const saved = edit.before
        ? await vault.write(edit.path, edit.content, edit.before.revision)
        : await vault.create(edit.path, edit.content);
      written.push({ edit, revision: saved.revision });
    }
    if (preferencesChanged) {
      await vault.setPreferences({ bookmarkItems });
      preferencesWritten = true;
    }
    if (request.operation === "merge" && request.replacement === "none") {
      if ((await vault.read(source.path)).revision !== source.revision)
        throw Error("Исходная заметка изменилась во время переноса");
      await vault.trash(source.path);
    }
  } catch (error) {
    const incomplete: string[] = [];
    if (preferencesWritten)
      try {
        if (
          JSON.stringify(vault.preferences.bookmarkItems) ===
          JSON.stringify(bookmarkItems)
        )
          await vault.setPreferences({
            bookmarkItems: previousPreferences.bookmarkItems,
          });
        else incomplete.push("закладки");
      } catch {
        incomplete.push("закладки");
      }
    for (const { edit, revision } of written.reverse())
      try {
        if (edit.before) await vault.write(edit.path, edit.before.content, revision);
        else if ((await vault.read(edit.path)).revision === revision)
          await fs.unlink(await safePath(vault.root, edit.path));
        else incomplete.push(edit.path);
      } catch {
        incomplete.push(edit.path);
      }
    if (incomplete.length)
      throw Error(
        "Перенос прерван. Внешние правки сохранены; проверьте файлы и историю: " +
          incomplete.join(", "),
      );
    throw error;
  }
  return {
    target: request.target,
    changed: edits.map((edit) => edit.path),
    removed: request.operation === "merge" && request.replacement === "none",
  };
}
