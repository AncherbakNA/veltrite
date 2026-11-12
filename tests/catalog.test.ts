import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { Catalog } from "../electron/catalog";
import { Plugins } from "../electron/plugins";
import { mergePreferences } from "../electron/preferences";
import { validateCatalog } from "../shared/catalog";
import { contrast, readableAccent, validateTheme } from "../shared/themes";
import { defaultPreferences } from "../shared/types";
const bundled = path.resolve("catalog");
test("каталог содержит проверенные пакеты, темы соответствуют контрасту AA", async () => {
  const entries = validateCatalog(
    JSON.parse(await fs.readFile(path.join(bundled, "index.json"), "utf8")),
  );
  expect(entries).toHaveLength(4);
  for (const entry of entries)
    for (const asset of entry.assets) {
      const bytes = await fs.readFile(
        path.join(
          bundled,
          entry.kind === "theme" ? "themes" : "extensions",
          entry.id,
          asset.file,
        ),
      );
      expect(bytes.length).toBe(asset.size);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
      if (entry.kind === "theme") {
        const theme = validateTheme(JSON.parse(bytes.toString("utf8")));
        for (const colors of Object.values(theme.variants))
          for (const accent of [theme.accent, "#ffffff", "#000000", "#ffffaa"]) {
            const ink = readableAccent(accent, colors);
            expect(contrast(ink, colors.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(ink, colors.hover)).toBeGreaterThanOrEqual(4.5);
          }
        expect(
          mergePreferences(defaultPreferences, { customTheme: theme }).customTheme,
        ).toEqual(theme);
        expect(() =>
          validateTheme({
            ...theme,
            variants: {
              ...theme.variants,
              dark: { ...theme.variants.dark, text: theme.variants.dark.bg },
            },
          }),
        ).toThrow("контраст");
      }
    }
});
test("встроенный каталог устанавливает выключенное расширение и переносимую тему", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-catalog-test-"));
  try {
    const plugins = new Plugins(path.join(root, "plugins")),
      catalog = new Catalog(root, bundled, plugins);
    expect((await catalog.list()).source).toBe("bundled");
    await catalog.install("extension", "timestamp");
    expect((await plugins.get("timestamp")).enabled).toBe(false);
    await catalog.install("theme", "slate");
    expect((await catalog.themes())[0].name).toBe("Сланец");
    await catalog.removeTheme("slate");
    expect(await catalog.themes()).toEqual([]);
    await expect(catalog.install("extension", "../escape")).rejects.toThrow("не найден");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("изменённый пакет не устанавливается, недоступный каталог сохраняет встроенный", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "veltrite-catalog-test-"));
  try {
    const plugins = new Plugins(path.join(root, "plugins")),
      index = await fs.readFile(path.join(bundled, "index.json"));
    const corrupt = new Catalog(root, bundled, plugins, async (url) =>
      url.endsWith("index.json") ? index : Buffer.from("подмена"),
    );
    expect((await corrupt.list(true)).source).toBe("remote");
    await expect(corrupt.install("extension", "timestamp")).rejects.toThrow(
      "Контрольная сумма",
    );
    expect(await plugins.list()).toEqual([]);
    const offline = new Catalog(root, bundled, plugins, async () => {
      throw Error("Нет сети");
    });
    expect(await offline.list(true)).toMatchObject({
      source: "bundled",
      error: "Нет сети",
    });
    const malformed = JSON.parse(index.toString());
    malformed.entries[0].assets[0].file = "../../escape";
    expect(() => validateCatalog(malformed)).toThrow("набор файлов");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("медный акцент адаптируется к теме, подписи кнопок сохраняют контраст", async () => {
  const { DEFAULT_ACCENT, LIGHT_ACCENT, accentForTheme, accentButtonText } =
    await import("../shared/themes");
  expect(accentForTheme(DEFAULT_ACCENT, true)).toBe(DEFAULT_ACCENT);
  expect(accentForTheme(DEFAULT_ACCENT, false)).toBe(LIGHT_ACCENT);
  expect(accentForTheme("#426b50", false)).toBe("#426b50");
  for (const color of [
    DEFAULT_ACCENT,
    LIGHT_ACCENT,
    "#74805a",
    "#a77d68",
    "#8f734f",
    "#8a6e74",
    "#717b7a",
  ])
    expect(contrast(color, accentButtonText(color))).toBeGreaterThanOrEqual(4.5);
});
