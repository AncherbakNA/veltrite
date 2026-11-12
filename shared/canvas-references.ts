import { movedPath, rewriteMarkdownLinks, type ReferenceMove } from "./rename-links";
import type { NoteIndex } from "./types";
export function rewriteCanvasReferences(
  content: string,
  oldSource: string,
  newSource: string,
  from: string,
  to: string,
  isDirectory: boolean,
  paths: string[],
  index: NoteIndex[],
  anchors?: ReferenceMove,
): string {
  try {
    const canvas = JSON.parse(content);
    if (!Array.isArray(canvas.nodes)) return content;
    let changed = false;
    for (const node of canvas.nodes) {
      if (!node || typeof node !== "object") continue;
      for (const field of ["file", "background"])
        if (typeof node[field] === "string") {
          const original = node[field];
          let replacement = movedPath(original, from, to, isDirectory);
          if (
            field === "file" &&
            anchors &&
            original === anchors.source &&
            typeof node.subpath === "string" &&
            node.subpath.startsWith("#")
          ) {
            const mapped = anchors.fragment(node.subpath.slice(1));
            if (mapped !== null) {
              replacement = anchors.target;
              if ("#" + mapped !== node.subpath) {
                node.subpath = "#" + mapped;
                changed = true;
              }
            }
          }
          if (replacement !== original) {
            node[field] = replacement;
            changed = true;
          }
        }
      if (typeof node.text === "string") {
        const text = rewriteMarkdownLinks(
          node.text,
          oldSource,
          newSource,
          from,
          to,
          isDirectory,
          paths,
          index,
          anchors,
        );
        if (text !== node.text) {
          node.text = text;
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(canvas, null, 2) : content;
  } catch {
    return content;
  }
}
