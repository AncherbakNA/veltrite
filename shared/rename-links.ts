import { relativeLink } from "./links";
import { resolveLink } from "./markdown";
import { literalRanges } from "./markdown-literals";
import type { NoteIndex } from "./types";
export interface ReferenceMove {
  source: string;
  target: string;
  fragment: (value: string) => string | null;
}
export function movedPath(
  target: string,
  from: string,
  to: string,
  isDirectory: boolean,
) {
  if (target === from) return to;
  return isDirectory && target.startsWith(from + "/")
    ? to + target.slice(from.length)
    : target;
}
/** Resolve once in the old context, then relocate both the file and its anchor. */
export function rewriteMarkdownLinks(
  content: string,
  oldSource: string,
  newSource: string,
  from: string,
  to: string,
  isDirectory: boolean,
  paths: string[],
  index: NoteIndex[],
  anchors?: ReferenceMove,
) {
  const reference = (target: string, wiki: boolean): string => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
    const hash = target.indexOf("#"),
      file = hash < 0 ? target : target.slice(0, hash),
      fragment = hash < 0 ? null : target.slice(hash + 1),
      resolved = file ? resolveLink(file, oldSource, paths, index) : oldSource;
    if (!resolved) return target;
    let destination = movedPath(resolved, from, to, isDirectory),
      nextFragment = fragment;
    if (anchors && resolved === anchors.source && fragment !== null) {
      const mapped = anchors.fragment(fragment);
      if (mapped !== null) {
        destination = anchors.target;
        nextFragment = mapped;
      }
    }
    if (destination === resolved && nextFragment === fragment && oldSource === newSource)
      return target;
    const path =
      (!file && destination === newSource) ||
      (destination === newSource && destination !== resolved && fragment !== null)
        ? ""
        : wiki
          ? /\.md$/i.test(file)
            ? destination
            : destination.replace(/\.md$/i, "")
          : relativeLink(newSource, destination);
    return path + (nextFragment === null ? "" : "#" + nextFragment);
  };
  const rewrite = (text: string) =>
    text
      .replace(
        /(!?\[\[)([^\]|]+)([^\]]*\]\])/g,
        (_whole, start, target, end) => start + reference(target, true) + end,
      )
      .replace(
        /(!?\[[^\]]*\]\()([^\s)]+)(\))/g,
        (_whole, start, target, end) => start + reference(target, false) + end,
      );
  const ranges = literalRanges(content, true);
  let fromOffset = 0,
    result = "";
  for (const range of ranges) {
    result +=
      rewrite(content.slice(fromOffset, range.from)) +
      content.slice(range.from, range.to);
    fromOffset = range.to;
  }
  return result + rewrite(content.slice(fromOffset));
}
