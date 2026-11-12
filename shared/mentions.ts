import { literalRanges } from "./markdown-ranges";
export interface UnlinkedMention {
  path: string;
  target: string;
  text: string;
  from: number;
  to: number;
  line: number;
  context: string;
  revision: string;
}

/** Mask syntax without moving offsets: code, comments, frontmatter and existing links. */
export function mentionText(content: string): string {
  const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
  const ranges = literalRanges(content);
  const frontmatter = /^---\r?\n[^]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (frontmatter) ranges.push({ from: 0, to: frontmatter[0].length });
  for (const match of content.matchAll(
    /<!--[^]*?-->|%%[^]*?%%|(?:^|\s)#[\p{L}\p{N}_/-]+|https?:\/\/\S+/gu,
  ))
    ranges.push({ from: match.index!, to: match.index! + match[0].length });
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  let offset = 0,
    result = "";
  for (const range of ranges) {
    if (range.to <= offset) continue;
    result +=
      content.slice(offset, Math.max(offset, range.from)) +
      blank(content.slice(Math.max(offset, range.from), range.to));
    offset = range.to;
  }
  return result + content.slice(offset);
}
export function findMentions(
  content: string,
  names: string[],
  limit = 100,
  masked = mentionText(content),
): { from: number; to: number; text: string; line: number; context: string }[] {
  const unique = [
    ...new Set(names.filter((name) => name.trim() && name.length <= 500)),
  ].sort((a, b) => b.length - a.length);
  if (!unique.length) return [];
  const pattern = unique
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const result = [],
    expression = new RegExp(pattern, "giu");
  let line = 1,
    previous = 0;
  for (const match of masked.matchAll(expression)) {
    const from = match.index!,
      to = from + match[0].length;
    if (
      (/[\p{L}\p{N}_]/u.test(match[0][0]) &&
        /[\p{L}\p{N}_]/u.test(masked[from - 1] || "")) ||
      (/[\p{L}\p{N}_]/u.test(match[0].at(-1)!) && /[\p{L}\p{N}_]/u.test(masked[to] || ""))
    )
      continue;
    for (let i = previous; i < from; i++) if (content[i] === "\n") line++;
    previous = from;
    result.push({
      from,
      to,
      text: content.slice(from, to),
      line,
      context: (() => {
        const start = Math.max(0, from - 100),
          prefix = content.slice(start, from),
          suffix = content.slice(to, to + 160),
          next = suffix.indexOf("\n");
        return (
          prefix.slice(prefix.lastIndexOf("\n") + 1) +
          content.slice(from, to) +
          suffix.slice(0, next < 0 ? suffix.length : next)
        );
      })().trim(),
    });
    if (result.length >= limit) break;
  }
  return result;
}
