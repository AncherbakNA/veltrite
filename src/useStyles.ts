import { useEffect } from "react";
import type { Preferences } from "../shared/types";
import { api } from "./useVault";
const aliases: Record<string, string> = {
  "background-primary": "bg",
  "background-secondary": "sidebar",
  "background-modifier-hover": "hover",
  "background-modifier-border": "border",
  "text-normal": "text",
  "text-muted": "muted",
  "text-faint": "faint",
  "interactive-accent": "accent",
  "text-accent": "accent-ink",
  "text-on-accent": "accent-button-text",
  "background-primary-alt": "panel",
};
export function useStyles(
  preferences: Preferences | undefined,
  root: string | undefined,
) {
  useEffect(() => {
    let alive = true;
    const sheet = document.createElement("style");
    sheet.dataset.veltriteStyles = "true";
    const apply = async () => {
      if (!preferences) return;
      const styles = await api().styles();
      if (!alive) return;
      const ids = [preferences.cssTheme, ...preferences.cssSnippets].filter(Boolean);
      const base = getComputedStyle(document.documentElement);
      const defaults = Object.entries(aliases)
        .map(([key, value]) => `--${key}:${base.getPropertyValue("--" + value)};`)
        .join("");
      const bridge = Object.entries(aliases)
        .map(([key, value]) => `--${value}:var(--${key});`)
        .join("");
      sheet.textContent =
        `body {${defaults}}\n` +
        (preferences.cssTheme &&
        /--(?:background-primary|text-normal|interactive-accent)\s*:/.test(
          styles.find((style) => style.id === preferences.cssTheme)?.css || "",
        )
          ? `body {${bridge}}\n`
          : "") +
        ids.map((id) => styles.find((style) => style.id === id)?.css || "").join("\n");
      document.head.append(sheet);
    };
    const changed = () => {
      void apply().catch(() => {});
    };
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", changed);
    changed();
    return () => {
      alive = false;
      sheet.remove();
      system.removeEventListener("change", changed);
    };
  }, [
    root,
    preferences?.theme,
    JSON.stringify(preferences?.customTheme),
    preferences?.accent,
    preferences?.cssTheme,
    JSON.stringify(preferences?.cssSnippets),
    preferences?.styleRevision,
  ]);
}
