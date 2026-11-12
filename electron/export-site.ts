import fs from "node:fs/promises";
import path from "node:path";
import { relativeLink } from "../shared/links";
import { canonicalRoot, relativePath, safePath } from "./paths";
import { Vault, atomicWrite } from "./vault";
export interface StaticPage {
  path: string;
  title: string;
  html: string;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export async function exportSite(
  vault: Vault,
  pages: StaticPage[],
  destination: string,
  assetsDirectory: string,
) {
  const to = await canonicalRoot(destination);
  if (
    to === vault.root ||
    to.startsWith(vault.root + path.sep) ||
    vault.root.startsWith(to + path.sep)
  )
    throw Error("Выберите папку вне хранилища");
  if ((await fs.readdir(to)).length) throw Error("Папка сайта должна быть пустой");
  if (!Array.isArray(pages) || pages.length > 50000)
    throw Error("Некорректный список страниц");
  for (const page of pages) {
    relativePath(page.path);
    if (
      !page.path.startsWith("notes/") ||
      !page.path.endsWith(".html") ||
      typeof page.title !== "string" ||
      typeof page.html !== "string" ||
      page.html.length > 32 * 1024 * 1024
    )
      throw Error("Некорректная страница");
  }
  const shell = (pagePath: string, title: string, body: string) =>
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; object-src 'none'"><title>${escape(title)} — ${escape(path.basename(vault.root))}</title>${styles.map((style) => `<link rel="stylesheet" href="${relativeLink(pagePath, "static/" + style)}">`).join("")}<style>:root{--bg:#fbfaf7;--text:#24221f;--muted:#625d55;--faint:#686158;--sidebar:#f1eee8;--surface:#eeebe5;--border:#d7d2c8;--accent:#c0603a;--accent-ink:#a95032;--green:#42623a;color-scheme:light}body{overflow:auto;background:var(--bg);color:var(--text);padding:40px 24px;margin:auto;max-width:850px;font:16px/1.6 system-ui}nav{font-size:12px;margin-bottom:40px}nav a{color:var(--muted)}.markdown{font-size:16px}.markdown input{pointer-events:none}footer{margin-top:60px;border-top:1px solid #eee;padding-top:20px;color:var(--muted);font-size:12px}li{margin:8px 0}a{color:var(--accent-ink)}</style></head><body><nav><a href="${relativeLink(pagePath, "index.html")}">${escape(path.basename(vault.root))}</a></nav>${body}<footer>Опубликовано из Veltrite</footer></body></html>`;
  const styles: string[] = [];
  for (const entry of await fs.readdir(assetsDirectory)) {
    if (!/\.(css|woff2?|ttf)$/.test(entry)) continue;
    await atomicWrite(
      await safePath(to, "static/" + entry),
      await fs.readFile(path.join(assetsDirectory, entry)),
    );
    if (entry.endsWith(".css")) styles.push(entry);
  }
  for (const page of pages)
    await atomicWrite(
      await safePath(to, page.path),
      shell(page.path, page.title, page.html),
    );
  await atomicWrite(
    path.join(to, "index.html"),
    shell(
      "index.html",
      path.basename(vault.root),
      `<div class="markdown"><h1>${escape(path.basename(vault.root))}</h1><ul>${pages.map((p) => `<li><a href="${relativeLink("index.html", p.path)}">${escape(p.title)}</a></li>`).join("")}</ul></div>`,
    ),
  );
  for (const entry of (await vault.list()).filter(
    (f) => f.kind !== "note" && f.kind !== "folder",
  ))
    await atomicWrite(
      await safePath(to, "files/" + entry.path),
      await fs.readFile(await safePath(vault.root, entry.path)),
    );
  await atomicWrite(path.join(to, ".nojekyll"), "");
  return pages.length;
}
