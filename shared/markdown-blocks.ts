import { maskMarkdownComments } from "./markdown-comments";
export interface RenderedBlock {
  kind: "table" | "math" | "mermaid" | "base";
  from: number;
  to: number;
  source: string;
}

interface SourceLine {
  text: string;
  from: number;
  to: number;
  number: number;
}
function sourceLines(source: string): SourceLine[] {
  let offset = 0;
  return source.split("\n").map((text, index) => {
    const line = {
      text: text.replace(/\r$/, ""),
      from: offset,
      to: offset + text.length,
      number: index + 1,
    };
    offset += text.length + 1;
    return line;
  });
}

/** Split table cells without treating escaped pipes or inline code as separators. */
export function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "",
    code = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cell += line[i] + line[++i];
      continue;
    }
    if (line[i] === "`") {
      let count = 1;
      while (line[i + count] === "`") count++;
      if (!code) code = count;
      else if (code === count) code = 0;
      cell += "`".repeat(count);
      i += count - 1;
      continue;
    }
    if (line[i] === "|" && !code) {
      cells.push(cell.trim());
      cell = "";
    } else cell += line[i];
  }
  cells.push(cell.trim());
  if (line.trimStart().startsWith("|")) cells.shift();
  if (line.trimEnd().endsWith("|") && cells.at(-1) === "") cells.pop();
  return cells;
}

export function renderedBlocks(source: string): RenderedBlock[] {
  const original = source;
  source = maskMarkdownComments(source);
  const lines = sourceLines(source),
    result: RenderedBlock[] = [];
  const add = (kind: RenderedBlock["kind"], start: number, end: number) => {
    const from = lines[start].from,
      to = lines[end].to;
    result.push({ kind, from, to, source: original.slice(from, to) });
  };
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && lines[i].text === "---") {
      const end = lines.findIndex((line, index) => index > 0 && line.text === "---");
      if (end > 0) {
        i = end;
        continue;
      }
    }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (fence) {
      let end = i + 1;
      while (
        end < lines.length &&
        !new RegExp("^ {0,3}" + fence[1][0] + "{" + fence[1].length + ",}\\s*$").test(
          lines[end].text,
        )
      )
        end++;
      if (end === lines.length) break;
      if (fence[2].trim() === "mermaid") add("mermaid", i, end);
      if (fence[2].trim() === "base") add("base", i, end);
      i = end;
      continue;
    }
    if (/^\s*\$\$/.test(lines[i].text)) {
      if (/^\s*\$\$.+\$\$\s*$/.test(lines[i].text)) {
        add("math", i, i);
        continue;
      }
      if (!/^\s*\$\$\s*$/.test(lines[i].text)) continue;
      let end = i + 1;
      while (end < lines.length && !/^\s*\$\$\s*$/.test(lines[end].text)) end++;
      if (end < lines.length) {
        add("math", i, end);
        i = end;
      }
      continue;
    }
    if (!lines[i].text.includes("|") || !lines[i + 1]?.text.includes("-")) continue;
    const header = tableCells(lines[i].text),
      delimiter = tableCells(lines[i + 1].text);
    if (
      header.length < 1 ||
      header.length !== delimiter.length ||
      !delimiter.every((cell) => /^:?-{3,}:?$/.test(cell))
    )
      continue;
    let end = i + 1;
    while (
      lines[end + 1]?.text.trim() &&
      lines[end + 1].text.includes("|") &&
      !/^\s*[`~]{3}/.test(lines[end + 1].text)
    )
      end++;
    add("table", i, end);
    i = end;
  }
  return result;
}

export interface ReferenceBlock {
  id: string;
  from: number;
  to: number;
  line: number;
  text: string;
}
export function referenceBlocks(source: string): ReferenceBlock[] {
  const original = source;
  source = maskMarkdownComments(source);
  const lines = sourceLines(source),
    result: ReferenceBlock[] = [];
  let fence: { marker: string; length: number } | null = null,
    start = 0;
  let fenceStart = 0,
    closedFence: { start: number; end: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && lines[i].text === "---") {
      const end = lines.findIndex((line, index) => index > 0 && line.text === "---");
      if (end > 0) {
        i = end;
        start = end + 1;
        continue;
      }
    }
    const line = lines[i],
      marker = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)?.[1];
    if (marker) {
      if (!fence) {
        fence = { marker: marker[0], length: marker.length };
        start = i;
        fenceStart = i;
      } else if (marker[0] === fence.marker && marker.length >= fence.length) {
        fence = null;
        closedFence = { start: fenceStart, end: i };
      }
      continue;
    }
    if (fence) continue;
    if (!line.text.trim()) {
      start = i + 1;
      continue;
    }
    if (/^#{1,6}\s/.test(line.text) || (i > 0 && /^#{1,6}\s/.test(lines[i - 1].text)))
      start = i;
    const match = /(?:^|\s)\^([\p{L}\p{N}_-]+)\s*$/u.exec(line.text);
    if (!match) continue;
    const standalone = line.text.trim() === "^" + match[1];
    let begin = start;
    if (standalone) {
      let previous = i - 1;
      while (previous >= 0 && !lines[previous].text.trim()) previous--;
      begin = previous;
      if (closedFence?.end === previous) begin = closedFence.start;
      else
        while (
          begin > 0 &&
          lines[begin - 1].text.trim() &&
          !/^\s*---\s*$/.test(lines[begin - 1].text)
        )
          begin--;
      if (previous < 0) continue;
    }
    const from = lines[Math.max(0, begin)].from,
      to = line.to;
    result.push({
      id: match[1],
      from,
      to,
      line: lines[Math.max(0, begin)].number,
      text: original
        .slice(from, to)
        .replace(/\s*\^[\p{L}\p{N}_-]+\s*$/u, "")
        .trimEnd(),
    });
    start = i + 1;
  }
  return result;
}

export function headingId(text: string) {
  return text
    .replace(/\s+\^[\p{L}\p{N}_-]+\s*$/u, "")
    .replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_all, target, label) => label || target,
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, "-");
}

export function decodeFragment(target: string) {
  if (!target.includes("#")) return "";
  const fragment = target.slice(target.indexOf("#") + 1).split("|")[0];
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** A global set also avoids collisions with literal headings such as Foo-2. */
export function headingSlugger() {
  const used = new Set<string>();
  return (text: string) => {
    const base = headingId(text) || "section";
    let id = base,
      suffix = 2;
    while (used.has(id)) id = base + "-" + suffix++;
    used.add(id);
    return id;
  };
}

export interface NoteHeading {
  text: string;
  id: string;
  level: number;
  line: number;
  from: number;
}
export function noteHeadings(source: string): NoteHeading[] {
  source = maskMarkdownComments(source);
  const lines = sourceLines(source),
    slug = headingSlugger(),
    result: NoteHeading[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && lines[i].text === "---") {
      const end = lines.findIndex((line, index) => index > 0 && line.text === "---");
      if (end > 0) {
        i = end;
        continue;
      }
    }
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i].text);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(lines[i].text);
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(lines[i + 1]?.text || "");
    const setext =
      !heading &&
      underline &&
      lines[i].text.trim() &&
      !/^\s*(?:[-*+>]\s|\d+[.)]\s|#{1,6}\s|\|)/.test(lines[i].text);
    if (!heading && !setext) continue;
    const text = heading ? heading[2] : lines[i].text.trim();
    result.push({
      text,
      id: slug(text),
      level: heading ? heading[1].length : underline![1][0] === "=" ? 1 : 2,
      line: i + 1,
      from: lines[i].from,
    });
    if (setext) i++;
  }
  return result;
}

export function findHeading(headings: NoteHeading[], fragment: string) {
  const id = headingId(fragment);
  return (
    headings.find((heading) => heading.id === id) ||
    headings.find((heading) => headingId(heading.text) === id)
  );
}

/** A heading or block embed includes only the requested fragment. */
export function noteFragment(source: string, target: string): string | null {
  const fragment = decodeFragment(target);
  if (!fragment) return source;
  if (fragment.startsWith("^"))
    return (
      referenceBlocks(source).find((block) => block.id === fragment.slice(1))?.text ??
      null
    );
  const headings = noteHeadings(source),
    heading = findHeading(headings, fragment);
  if (!heading) return null;
  const end = headings.find(
    (item) => item.from > heading.from && item.level <= heading.level,
  )?.from;
  return source.slice(heading.from, end).trimEnd();
}
