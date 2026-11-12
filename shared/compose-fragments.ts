import {
  decodeFragment,
  findHeading,
  headingId,
  noteHeadings,
  referenceBlocks,
} from "./markdown-blocks";
/** Unique source anchors keep links into both notes valid, including a prepend merge. */
export function planMovedFragments(
  source: string,
  target: string,
  original = source,
  offset = 0,
) {
  const targetHeadings = new Set(noteHeadings(target).map((heading) => heading.id)),
    occupied = new Set<string>(),
    mapping = new Map<string, string>(),
    edits: { from: number; to: number; text: string }[] = [],
    originals = noteHeadings(original);
  for (const heading of noteHeadings(source)) {
    const base = headingId(heading.text) || "section";
    let candidate = base,
      number = 2;
    while (occupied.has(candidate)) candidate = base + "-" + number++;
    if (targetHeadings.has(base) || targetHeadings.has(candidate)) {
      let suffix = 2,
        title: string;
      do {
        title = heading.text + " (" + suffix++ + ")";
        candidate = headingId(title);
      } while (occupied.has(candidate) || targetHeadings.has(candidate));
      const end = source.indexOf("\n", heading.from),
        until = end < 0 ? source.length : end,
        line = source.slice(heading.from, until),
        atx = /^( {0,3}#{1,6}[ \t]+)(.*?)([ \t]+#+[ \t]*)?$/.exec(line);
      edits.push({
        from: heading.from,
        to: until,
        text: atx ? atx[1] + title + (atx[3] || "") : title,
      });
    }
    occupied.add(candidate);
    const previous = originals.find((item) => item.from === heading.from + offset);
    if (previous) mapping.set(previous.id, candidate);
  }
  const blocks = new Set(referenceBlocks(target).map((block) => block.id));
  for (const block of referenceBlocks(source)) {
    let id = block.id,
      suffix = 2;
    while (blocks.has(id)) id = block.id + "-" + suffix++;
    blocks.add(id);
    mapping.set("^" + block.id, "^" + id);
    if (id !== block.id) {
      const marker = /\^([\p{L}\p{N}_-]+)\s*$/u.exec(source.slice(block.from, block.to));
      if (marker)
        edits.push({
          from: block.from + marker.index + 1,
          to: block.from + marker.index + 1 + block.id.length,
          text: id,
        });
    }
  }
  let content = source;
  for (const edit of edits.sort((a, b) => b.from - a.from))
    content = content.slice(0, edit.from) + edit.text + content.slice(edit.to);
  const remap = (fragment: string): string | null => {
    const decoded = decodeFragment("#" + fragment),
      key = decoded.startsWith("^") ? decoded : findHeading(originals, decoded)?.id;
    if (!key || !mapping.has(key)) return null;
    const next = mapping.get(key)!;
    return next === key ? fragment : next;
  };
  return { content, mapping, remap };
}
