import { GFM, parser } from "@lezer/markdown";
const markdown = parser.configure(GFM);
export function literalRanges(
  source: string,
  codeOnly = false,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  markdown.parse(source).iterate({
    enter(node) {
      if (
        (codeOnly
          ? /^(?:FencedCode|CodeBlock|InlineCode|HTMLTag|HTMLBlock)$/
          : /^(?:FencedCode|CodeBlock|InlineCode|Link|Image|Autolink|HTMLTag|HTMLBlock)$/
        ).test(node.name)
      ) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  return ranges;
}
