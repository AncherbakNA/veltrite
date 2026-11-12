import { literalRanges } from "./markdown-literals";
/** Keep UTF-16 offsets/newlines intact so tasks and source links still address the original note. */
export function maskMarkdownComments(source: string): string {
  if (!source.includes("%%")) return source;
  const literals = literalRanges(source);
  let cursor = 0,
    result = "",
    range = 0;
  while (cursor < source.length) {
    const start = source.indexOf("%%", cursor);
    if (start < 0) break;
    while (literals[range] && literals[range].to <= start) range++;
    const protectedRange = literals[range];
    if (
      (protectedRange && protectedRange.from <= start) ||
      (source[start - 1] === "\\" && source[start - 2] !== "\\")
    ) {
      const end =
        protectedRange && protectedRange.from <= start ? protectedRange.to : start + 2;
      result += source.slice(cursor, end);
      cursor = end;
      continue;
    }
    const close = source.indexOf("%%", start + 2),
      end = close < 0 ? source.length : close + 2;
    result +=
      source.slice(cursor, start) + source.slice(start, end).replace(/[^\r\n]/g, " ");
    cursor = end;
  }
  return result + source.slice(cursor);
}
