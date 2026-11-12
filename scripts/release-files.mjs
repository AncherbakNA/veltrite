import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
async function digest(file, algorithm, encoding = "hex") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}
export async function assembleRelease(input, output, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Некорректная версия релиза");
  const expected = [
      `Veltrite-${version}-mac-arm64.dmg`,
      `Veltrite-${version}-mac-arm64.zip`,
      `Veltrite-${version}-mac-x64.dmg`,
      `Veltrite-${version}-mac-x64.zip`,
      `Veltrite-${version}-win-x64.exe`,
      `Veltrite-${version}-win-x64.zip`,
    ],
    files = new Map();
  async function walk(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error("Символическая ссылка в артефактах релиза");
      const file = join(directory, item.name);
      if (item.isDirectory()) await walk(file);
      else if (
        expected.includes(item.name) ||
        expected.some((name) => item.name === name + ".blockmap")
      ) {
        const previous = files.get(item.name);
        if (
          previous &&
          (await digest(previous, "sha256")) !== (await digest(file, "sha256"))
        )
          throw Error("Разные артефакты имеют одинаковое имя");
        files.set(item.name, file);
      }
    }
  }
  await walk(resolve(input));
  for (const name of expected)
    if (!files.has(name)) throw Error("Не найден установщик: " + name);
  await fs.mkdir(output, { recursive: true });
  for (const [name, file] of files) await fs.copyFile(file, join(output, name));
  async function feed(names) {
    const records = [];
    for (const name of names) {
      const file = join(output, name),
        stat = await fs.stat(file);
      records.push({
        url: name,
        sha512: await digest(file, "sha512", "base64"),
        size: stat.size,
      });
    }
    return {
      version,
      files: records,
      path: records[0].url,
      sha512: records[0].sha512,
      releaseDate: new Date().toISOString(),
    };
  }
  await fs.writeFile(
    join(output, "latest.yml"),
    JSON.stringify(
      await feed(expected.filter((name) => name.endsWith(".exe"))),
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(
    join(output, "latest-mac.yml"),
    JSON.stringify(
      await feed(
        expected.filter((name) => name.includes("-mac-") && name.endsWith(".zip")),
      ),
      null,
      2,
    ) + "\n",
  );
  const names = [...files.keys(), "latest.yml", "latest-mac.yml"].sort(),
    checksums = [];
  for (const name of names)
    checksums.push((await digest(join(output, name), "sha256")) + "  " + name);
  await fs.writeFile(join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
  return names;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [input, output, version] = process.argv.slice(2);
  if (!input || !output || !version)
    throw Error("Укажите папки артефактов, результата и версию");
  const files = await assembleRelease(input, output, version);
  console.log("Подготовлены файлы релиза: " + files.length);
}
