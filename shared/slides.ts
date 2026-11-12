import { maskMarkdownComments } from "./markdown-comments";
import { literalRanges } from "./markdown-literals";
export function splitSlides(body: string): string[] {
  const source = maskMarkdownComments(body),
    literals = literalRanges(source),
    result: string[] = [];
  let from = 0,
    range = 0;
  for (const match of source.matchAll(/^ {0,3}---[ \t]*\r?$/gm)) {
    while (literals[range] && literals[range].to <= match.index) range++;
    if (literals[range] && literals[range].from <= match.index) continue;
    result.push(body.slice(from, match.index));
    from = match.index + match[0].length;
  }
  result.push(body.slice(from));
  return result;
}
