import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
export function relativePath(value: unknown, allowMeta = false): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  )
    throw Error("Недопустимый путь");
  const parts = value.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        p.length > 200 ||
        /[<>:"|?*\x00-\x1f]/.test(p) ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p) ||
        (!allowMeta && p.startsWith(".")),
    )
  )
    throw Error("Имя несовместимо с macOS и Windows");
  return parts.join("/");
}
export async function safePath(
  root: string,
  relative: string,
  allowMeta = false,
): Promise<string> {
  relativePath(relative, allowMeta);
  const target = path.resolve(root, ...relative.split("/"));
  if (!target.startsWith(root + path.sep)) throw Error("Путь находится вне хранилища");
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("Символические ссылки не поддерживаются");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return target;
}
export async function canonicalRoot(root: string): Promise<string> {
  const result = await realpath(root);
  if (!(await lstat(result)).isDirectory()) throw Error("Выберите папку хранилища");
  return result;
}
export async function ensureParent(file: string) {
  await mkdir(path.dirname(file), { recursive: true });
}
