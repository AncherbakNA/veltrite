import {
  existsSync,
  realpathSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";

function dependencyRoot(name, from) {
  let directory = from;
  while (true) {
    const candidate = join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function collectNotices(destination) {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")),
    visited = new Set(),
    notices = [];
  function visit(name, from) {
    const root = dependencyRoot(name, from);
    if (!root) return;
    const data = JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
      identity = data.name + "@" + data.version;
    if (visited.has(identity)) return;
    visited.add(identity);
    const documents = readdirSync(root).filter((file) =>
      /^(LICEN[CS]E|COPYING|NOTICE)(\.|$)/i.test(file),
    );
    const text = documents
      .map((file) => {
        try {
          return readFileSync(join(root, file), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n\n");
    notices.push(
      identity +
        "\nЛицензия: " +
        (typeof data.license === "string"
          ? data.license
          : JSON.stringify(data.license || "см. документы пакета")) +
        "\n\n" +
        text,
    );
    for (const dependency of Object.keys(data.dependencies || {}))
      visit(dependency, root);
  }
  for (const name of Object.keys(manifest.dependencies || {})) visit(name, resolve("."));
  writeFileSync(
    destination,
    "Лицензии зависимостей Veltrite\n\nТексты правообладателей приведены на языке оригинала.\n\n" +
      notices.sort().join("\n\n" + "=".repeat(72) + "\n\n"),
  );
}
