export const DEFAULT_ACCENT = "#b99871";
export const LIGHT_ACCENT = "#806342";
export function accentForTheme(accent: string, dark: boolean) {
  return accent.toLowerCase() === DEFAULT_ACCENT
    ? dark
      ? DEFAULT_ACCENT
      : LIGHT_ACCENT
    : accent;
}
export function accentButtonText(accent: string) {
  return contrast(accent, "#000000") >= contrast(accent, "#ffffff")
    ? "#000000"
    : "#ffffff";
}
export const themeTokens = [
  "bg",
  "panel",
  "sidebar",
  "ribbon",
  "surface",
  "hover",
  "border",
  "border-strong",
  "text",
  "muted",
  "faint",
  "green",
  "red",
] as const;
export type ThemeColors = Record<(typeof themeTokens)[number], string>;
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  accent: string;
  variants: { dark: ThemeColors; light: ThemeColors };
}
function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const n = parseInt(value, 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function validateTheme(input: unknown): ThemeDefinition {
  if (!input || typeof input !== "object") throw Error("Некорректная тема");
  const data = input as ThemeDefinition;
  if (
    typeof data.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(data.id) ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 100 ||
    typeof data.description !== "string" ||
    data.description.length > 2000 ||
    typeof data.version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(data.version) ||
    !/^#[a-f0-9]{6}$/i.test(data.accent) ||
    !data.variants
  )
    throw Error("Некорректная тема");
  const variants = {} as ThemeDefinition["variants"];
  for (const mode of ["dark", "light"] as const) {
    const colors = data.variants[mode];
    if (
      !colors ||
      typeof colors !== "object" ||
      Object.keys(colors).some(
        (key) => !themeTokens.includes(key as (typeof themeTokens)[number]),
      ) ||
      themeTokens.some(
        (key) => typeof colors[key] !== "string" || !/^#[a-f0-9]{6}$/i.test(colors[key]),
      )
    )
      throw Error("Тема должна содержать только цвета палитры в формате #RRGGBB");
    for (const text of ["text", "muted", "faint", "green", "red"] as const)
      for (const surface of [
        "bg",
        "panel",
        "sidebar",
        "ribbon",
        "surface",
        "hover",
      ] as const)
        if (contrast(colors[text], colors[surface]) < 4.5)
          throw Error(`Недостаточный контраст: ${mode}, ${text} на ${surface}`);
    variants[mode] = Object.fromEntries(
      themeTokens.map((key) => [key, colors[key]]),
    ) as ThemeColors;
  }
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    version: data.version,
    accent: data.accent,
    variants,
  };
}
export function readableAccent(accent: string, colors: ThemeColors): string {
  const backgrounds = [
    colors.bg,
    colors.panel,
    colors.sidebar,
    colors.ribbon,
    colors.surface,
    colors.hover,
  ];
  for (const target of ["#ffffff", "#000000"]) {
    for (let step = 0; step <= 20; step++) {
      const ratio = step / 20,
        channels = accent
          .slice(1)
          .match(/../g)!
          .map((part, i) =>
            Math.round(
              parseInt(part, 16) * (1 - ratio) +
                parseInt(target.slice(1 + i * 2, 3 + i * 2), 16) * ratio,
            )
              .toString(16)
              .padStart(2, "0"),
          );
      const color = "#" + channels.join("");
      if (backgrounds.every((background) => contrast(color, background) >= 4.5))
        return color;
    }
  }
  return colors.text;
}
