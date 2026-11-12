import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateCatalog, type CatalogEntry, type CatalogInfo } from "../shared/catalog";
import { validateTheme, type ThemeDefinition } from "../shared/themes";
import type { Plugins } from "./plugins";
import { atomicWrite } from "./vault";
const raw = "https://raw.githubusercontent.com/AncherbakNA/veltrite/";
async function download(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "Veltrite catalog (+https://github.com/AncherbakNA/veltrite)",
    },
  });
  if (!response.ok || !response.body)
    throw Error("Каталог недоступен: HTTP " + response.status);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("Файл каталога слишком большой");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export class Catalog {
  private current: CatalogInfo | null = null;
  constructor(
    private directory: string,
    private bundled: string,
    private plugins: Plugins,
    private fetchFile = download,
  ) {}
  async list(refresh = false): Promise<CatalogInfo> {
    if (refresh)
      try {
        const entries = validateCatalog(
          JSON.parse(
            (await this.fetchFile(raw + "main/catalog/index.json", 100 * 1024)).toString(
              "utf8",
            ),
          ),
        );
        this.current = { entries, source: "remote" };
      } catch (error: unknown) {
        this.current = null;
        const fallback = await this.list();
        return {
          ...fallback,
          error: error instanceof Error ? error.message : "Не удалось обновить каталог",
        };
      }
    if (!this.current) {
      const entries = validateCatalog(
        JSON.parse(await fs.readFile(path.join(this.bundled, "index.json"), "utf8")),
      );
      this.current = { entries, source: "bundled" };
    }
    return this.current;
  }
  private async assets(entry: CatalogEntry, source: CatalogInfo["source"]) {
    const folder = entry.kind === "extension" ? "extensions" : "themes",
      files = new Map<string, Buffer>();
    for (const asset of entry.assets) {
      const bytes =
        source === "bundled"
          ? await fs.readFile(path.join(this.bundled, folder, entry.id, asset.file))
          : await this.fetchFile(
              raw + entry.revision + `/catalog/${folder}/${entry.id}/${asset.file}`,
              asset.size,
            );
      if (
        bytes.length !== asset.size ||
        createHash("sha256").update(bytes).digest("hex") !== asset.sha256
      )
        throw Error(
          "Контрольная сумма пакета не совпала. Обновите каталог и повторите установку.",
        );
      files.set(asset.file, bytes);
    }
    return files;
  }
  async install(kind: CatalogEntry["kind"], id: string) {
    const catalog = await this.list(),
      entry = catalog.entries.find((entry) => entry.kind === kind && entry.id === id);
    if (!entry) throw Error("Пакет не найден в каталоге");
    const assets = await this.assets(entry, catalog.source);
    if (kind === "theme") {
      const theme = validateTheme(JSON.parse(assets.get("theme.json")!.toString("utf8")));
      if (theme.id !== entry.id || theme.version !== entry.version)
        throw Error("Метаданные темы не совпали с каталогом");
      await this.saveTheme(theme);
      return;
    }
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-catalog-"));
    try {
      const manifest = JSON.parse(assets.get("manifest.json")!.toString("utf8"));
      if (manifest.id !== entry.id || manifest.version !== entry.version)
        throw Error("Метаданные расширения не совпали с каталогом");
      for (const [file, bytes] of assets)
        await fs.writeFile(path.join(temporary, file), bytes, {
          mode: 0o600,
          flag: "wx",
        });
      await this.plugins.install(path.join(temporary, "manifest.json"));
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async themes(): Promise<ThemeDefinition[]> {
    let names: string[];
    try {
      names = await fs.readdir(path.join(this.directory, "themes"));
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const themes = await Promise.all(
      names
        .filter((name) => /^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(name))
        .map(async (name) => {
          try {
            return validateTheme(
              JSON.parse(
                await fs.readFile(path.join(this.directory, "themes", name), "utf8"),
              ),
            );
          } catch {
            return null;
          }
        }),
    );
    return themes.filter((theme): theme is ThemeDefinition => theme !== null);
  }
  async saveTheme(input: unknown) {
    const theme = validateTheme(input);
    await atomicWrite(
      path.join(this.directory, "themes", theme.id + ".json"),
      JSON.stringify(theme, null, 2),
    );
    return theme;
  }
  async removeTheme(id: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw Error("Некорректная тема");
    await fs.rm(path.join(this.directory, "themes", id + ".json"), { force: true });
  }
}
