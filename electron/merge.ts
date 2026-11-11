import path from "node:path";
import type { MergeResult, Snapshot } from "../shared/types";
import { hash } from "./vault";
export function mergeSnapshots(
  base: Snapshot,
  local: Snapshot,
  remote: Snapshot,
): MergeResult {
  const files: Snapshot = Object.create(null),
    conflicts: string[] = [];
  const equal = (a: any, b: any) => a?.hash === b?.hash;
  for (const key of new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ])) {
    const b = base[key],
      l = local[key],
      r = remote[key];
    if (equal(l, r)) {
      if (l) files[key] = l;
      continue;
    }
    if (equal(l, b)) {
      if (r) files[key] = r;
      continue;
    }
    if (equal(r, b)) {
      if (l) files[key] = l;
      continue;
    }
    if (key === ".veltrite/folders.json") {
      const parse = (value: any): string[] =>
        value ? JSON.parse(Buffer.from(value.content, "base64").toString("utf8")) : [];
      const before = new Set(parse(b)),
        left = new Set(parse(l)),
        right = new Set(parse(r));
      const folders = [...new Set([...left, ...right])]
        .filter((p) => !before.has(p) || (left.has(p) && right.has(p)))
        .sort();
      const bytes = Buffer.from(JSON.stringify(folders));
      files[key] = { hash: hash(bytes), content: bytes.toString("base64") };
      continue;
    }
    if (key === ".veltrite/shared.json") {
      const parse = (v: any) => {
        try {
          return JSON.parse(Buffer.from(v?.content || "", "base64").toString("utf8"));
        } catch {
          return {};
        }
      };
      const bv = parse(b),
        lv = parse(l),
        rv = parse(r),
        settings: Record<string, unknown> = {};
      for (const field of new Set([...Object.keys(lv), ...Object.keys(rv)]))
        settings[field] =
          JSON.stringify(lv[field]) === JSON.stringify(bv[field]) ? rv[field] : lv[field];
      const bytes = Buffer.from(JSON.stringify(settings));
      files[key] = { hash: hash(bytes), content: bytes.toString("base64") };
      continue;
    }
    if (r) files[key] = r;
    if (l) {
      const ext = path.posix.extname(key),
        stem = key.slice(0, key.length - ext.length);
      let name = `${stem} (конфликт ${l.hash.slice(0, 8)})${ext}`;
      let i = 2;
      while (
        (local[name] || remote[name] || files[name]) &&
        !equal(local[name] || remote[name] || files[name], l)
      )
        name = `${stem} (конфликт ${l.hash.slice(0, 8)} ${i++})${ext}`;
      files[name] = l;
    }
    conflicts.push(key);
  }
  return { files, conflicts };
}
