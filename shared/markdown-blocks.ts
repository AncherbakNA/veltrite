export interface RenderedBlock {
  kind: "table" | "math" | "mermaid";
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
  const lines = sourceLines(source),
    result: RenderedBlock[] = [];
  const add = (kind: RenderedBlock["kind"], start: number, end: number) => {
    const from = lines[start].from,
      to = lines[end].to;
    result.push({ kind, from, to, source: source.slice(from, to) });
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
      text: source
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

/** A heading or block embed includes only the requested fragment. */
export function noteFragment(source: string, target: string): string | null {
  let fragment = target.slice(target.indexOf("#") + 1);
  if (!target.includes("#") || !fragment) return source;
  try {
    fragment = decodeURIComponent(fragment);
  } catch {}
  if (fragment.startsWith("^"))
    return (
      referenceBlocks(source).find((block) => block.id === fragment.slice(1))?.text ??
      null
    );
  const lines = sourceLines(source);
  let start = -1,
    level = 0,
    fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^\s*(```+|~~~+)/.exec(lines[i].text)?.[1]?.[0];
    if (marker) {
      fence = fence === marker ? null : marker;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i].text);
    if (!heading) continue;
    if (start >= 0 && heading[1].length <= level)
      return source.slice(lines[start].from, lines[i].from).trimEnd();
    if (start < 0 && heading[2].toLocaleLowerCase() === fragment.toLocaleLowerCase()) {
      start = i;
      level = heading[1].length;
    }
  }
  return start >= 0 ? source.slice(lines[start].from).trimEnd() : null;
}
