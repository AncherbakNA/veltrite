import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { styleId, validateCss, type StyleDefinition } from "../shared/styles";
import { atomicWrite } from "./vault";
export class StyleStore {
  constructor(private directory: string) {}
  async list(): Promise<StyleDefinition[]> {
    await fs.mkdir(this.directory, { recursive: true });
    const names = await fs.readdir(this.directory);
    const result: StyleDefinition[] = [];
    for (const name of names
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .slice(0, 200)) {
      const file = path.join(this.directory, name),
        stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024)
        continue;
      try {
        const value = JSON.parse(await fs.readFile(file, "utf8"));
        styleId(value.id);
        validateCss(value.css);
        if (
          name !== value.id + ".json" ||
          !["theme", "snippet"].includes(value.kind) ||
          typeof value.name !== "string"
        )
          continue;
        result.push(value);
      } catch {}
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  async install(
    name: string,
    css: string,
    kind: StyleDefinition["kind"],
  ): Promise<StyleDefinition> {
    if (!["theme", "snippet"].includes(kind)) throw Error("Некорректный тип стиля");
    if ((await this.list()).length >= 200) throw Error("Можно установить до 200 стилей");
    const value: StyleDefinition = {
      id: randomUUID(),
      name: path
        .basename(name)
        .replace(/\.css$/i, "")
        .slice(0, 200),
      kind,
      css: validateCss(css),
    };
    await atomicWrite(
      path.join(this.directory, value.id + ".json"),
      JSON.stringify(value),
    );
    return value;
  }
  async save(id: string, css: string) {
    const value = (await this.list()).find((value) => value.id === styleId(id));
    if (!value) throw Error("Стиль не найден");
    await atomicWrite(
      path.join(this.directory, id + ".json"),
      JSON.stringify({ ...value, css: validateCss(css) }),
    );
  }
  async remove(id: string) {
    await fs.unlink(path.join(this.directory, styleId(id) + ".json"));
  }
}
