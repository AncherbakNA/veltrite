import fs from "node:fs/promises";
import path from "node:path";
import { safePath } from "./paths";
import type { Vault } from "./vault";
const mime: Record<string, string> = {
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".flac": "audio/flac",
};
export async function standaloneHtml(
  vault: Vault,
  html: string,
  assets: string,
): Promise<string> {
  let bytes = Buffer.byteLength(html);
  const limit = 64 * 1024 * 1024;
  const embed = async (file: string, type: string) => {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || bytes + stat.size * 1.4 > limit)
      throw Error("HTML с вложениями превышает ограничение 64 МиБ");
    const data = await fs.readFile(file);
    bytes += data.length * 1.4;
    return "data:" + type + ";base64," + data.toString("base64");
  };
  const replacements = new Map<string, string>();
  for (const match of html.matchAll(/veltrite-asset:\/\/vault\/[^"<>\s]+/g)) {
    if (replacements.has(match[0])) continue;
    const relative = decodeURIComponent(
        match[0].slice("veltrite-asset://vault/".length).replace(/&amp;/g, "&"),
      ),
      type = mime[path.extname(relative).toLowerCase()];
    if (!type || type.startsWith("font/"))
      throw Error("Неподдерживаемое вложение для экспорта HTML");
    replacements.set(match[0], await embed(await safePath(vault.root, relative), type));
  }
  html = html.replace(
    /veltrite-asset:\/\/vault\/[^"<>\s]+/g,
    (source) => replacements.get(source) || source,
  );
  const styles: string[] = [];
  for (const name of await fs.readdir(assets))
    if (name.endsWith(".css")) {
      let css = await fs.readFile(path.join(assets, name), "utf8");
      for (const match of [...css.matchAll(/url\(["']?(?:\.\/)?([^"')]+)["']?\)/g)]) {
        const relative = match[1].split(/[?#]/)[0],
          type = mime[path.extname(relative).toLowerCase()];
        if (
          !type?.startsWith("font/") ||
          relative.includes("/") ||
          relative.includes("\\")
        )
          continue;
        css = css.replaceAll(
          match[0],
          "url(" + (await embed(path.join(assets, relative), type)) + ")",
        );
      }
      styles.push(css.replace(/<\/style/gi, "<\\/style"));
    }
  return html.replace(
    "<!--veltrite-styles-->",
    "<style>" + styles.join("\n") + "</style>",
  );
}
