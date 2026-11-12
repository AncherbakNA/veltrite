import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergePreferences } from "../electron/preferences";
import { plural } from "../shared/format";
import { defaultPreferences } from "../shared/types";

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((part) => {
      const c = parseInt(part, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

describe("Оформление", () => {
  it("вторичный текст соответствует AA на всех поверхностях обеих тем", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const blocks = [...css.matchAll(/:root(?:\[data-theme="light"\])?\s*\{([^}]+)\}/g)];
    expect(blocks).toHaveLength(2);
    for (const [, block] of blocks) {
      const tokens = Object.fromEntries(
        [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]),
      );
      for (const text of ["text", "muted", "faint"])
        for (const surface of ["bg", "panel", "sidebar", "ribbon", "surface", "hover"]) {
          const a = luminance(tokens[text]),
            b = luminance(tokens[surface]);
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            `${text} на ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
    }
  });
  it("старые настройки получают шрифт по умолчанию, неизвестный шрифт отклоняется", () => {
    expect(mergePreferences(defaultPreferences, { fontSize: 18 }).textFont).toBe("serif");
    expect(mergePreferences(defaultPreferences, { textFont: "mono" }).textFont).toBe(
      "mono",
    );
    expect(() =>
      mergePreferences(defaultPreferences, { textFont: "remote-font" }),
    ).toThrow();
  });
});

it("склоняет счётчики для единиц, десятков и исключений 11–14", () => {
  const forms = ["связь", "связи", "связей"] as const;
  expect([0, 1, 2, 5, 11, 14, 21, 22, 111, -1].map((n) => plural(n, forms))).toEqual([
    "0 связей",
    "1 связь",
    "2 связи",
    "5 связей",
    "11 связей",
    "14 связей",
    "21 связь",
    "22 связи",
    "111 связей",
    "-1 связь",
  ]);
});
