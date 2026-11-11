import { relativeLink } from "../shared/links";
import { resolveLink } from "../shared/markdown";
import type { NoteIndex } from "../shared/types";

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

/** Ссылки внутри блоков кода и inline-code остаются буквальным текстом. */
export function rewriteMarkdownLinks(
  content: string,
  oldSource: string,
  newSource: string,
  from: string,
  to: string,
  isDirectory: boolean,
  paths: string[],
  index: NoteIndex[],
) {
  const rewrite = (text: string) => {
    const wiki = text.replace(
      /(!?\[\[)([^\]|#]+)([^\]]*\]\])/g,
      (whole, start, target, end) => {
        const resolved = resolveLink(target, oldSource, paths, index);
        if (!resolved) return whole;
        const replacement = movedPath(resolved, from, to, isDirectory);
        if (replacement === resolved) return whole;
        return (
          start +
          (/\.md$/i.test(target) ? replacement : replacement.replace(/\.md$/i, "")) +
          end
        );
      },
    );
    return wiki.replace(/(!?\[[^\]]*\]\()([^\s)]+)(\))/g, (whole, start, target, end) => {
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) return whole;
      const [file, subpath] = target.split("#"),
        resolved = resolveLink(file, oldSource, paths, index);
      if (!resolved) return whole;
      const replacement = movedPath(resolved, from, to, isDirectory);
      if (replacement === resolved && oldSource === newSource) return whole;
      return (
        start +
        relativeLink(newSource, replacement) +
        (subpath ? "#" + subpath : "") +
        end
      );
    });
  };
  let fence: string | null = null;
  return content
    .split(/(\r?\n)/)
    .map((line) => {
      if (/^\r?\n$/.test(line)) return line;
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (fence && marker[0] === fence[0] && marker.length >= fence.length)
          fence = null;
        else if (!fence) fence = marker;
        return line;
      }
      if (fence) return line;
      let offset = 0,
        result = "";
      for (const match of line.matchAll(/(`+)(.*?)\1/g)) {
        result += rewrite(line.slice(offset, match.index)) + match[0];
        offset = match.index! + match[0].length;
      }
      return result + rewrite(line.slice(offset));
    })
    .join("");
}
