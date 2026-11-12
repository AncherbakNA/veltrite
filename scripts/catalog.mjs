import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "catalog"),
  entries = [];
for (const [folder, kind] of [
  ["extensions", "extension"],
  ["themes", "theme"],
]) {
  for (const id of (await readdir(join(root, folder))).sort()) {
    const names = kind === "extension" ? ["manifest.json", "main.js"] : ["theme.json"];
    const metadata = JSON.parse(await readFile(join(root, folder, id, names[0]), "utf8"));
    const assets = [];
    for (const file of names) {
      const bytes = await readFile(join(root, folder, id, file));
      assets.push({
        file,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    entries.push({
      kind,
      id,
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      revision: "v0.3.0",
      assets,
    });
  }
}
await writeFile(
  join(root, "index.json"),
  JSON.stringify({ version: 1, entries }, null, 2) + "\n",
);
