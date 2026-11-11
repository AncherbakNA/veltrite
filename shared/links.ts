export function normalizePath(value: string): string | null {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
export function relativeLink(from: string, to: string) {
  const base = from.split("/").slice(0, -1),
    target = to.split("/");
  while (base.length && target.length && base[0] === target[0]) {
    base.shift();
    target.shift();
  }
  return [...base.map(() => ".."), ...target]
    .map((p) => (p === ".." ? p : encodeURIComponent(p)))
    .join("/");
}
