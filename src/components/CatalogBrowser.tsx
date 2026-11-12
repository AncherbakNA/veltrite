import { useEffect, useState } from "react";
import type { CatalogEntry, CatalogInfo } from "../../shared/catalog";
import type { ThemeDefinition } from "../../shared/themes";
import type { PluginInfo, Preferences } from "../../shared/types";
import { api } from "../useVault";
interface Props {
  kind: CatalogEntry["kind"];
  plugins?: PluginInfo[];
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
  onInstalled?: () => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}
const newer = (candidate: string, installed: string) => {
  const a = candidate.split(".").map(Number),
    b = installed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};
export default function CatalogBrowser({
  kind,
  plugins = [],
  preferences,
  onPreferences,
  onInstalled,
  onError,
  onMessage,
}: Props) {
  const [catalog, setCatalog] = useState<CatalogInfo | null>(null),
    [themes, setThemes] = useState<ThemeDefinition[]>([]),
    [busy, setBusy] = useState(false);
  const refreshThemes = async () => setThemes(await api().themes());
  useEffect(() => {
    let alive = true;
    Promise.all([api().catalog(), api().themes()])
      .then(([catalog, themes]) => {
        if (alive) {
          setCatalog(catalog);
          setThemes(themes);
        }
      })
      .catch((error) => {
        if (alive) onError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [onError]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: any) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async (theme: ThemeDefinition) =>
    onPreferences(await api().preferences({ customTheme: theme, accent: theme.accent }));
  return (
    <section
      className="catalog-browser"
      aria-label={kind === "theme" ? "Темы оформления" : "Каталог расширений"}
    >
      <div className="catalog-heading">
        <h3>{kind === "theme" ? "Темы оформления" : "Каталог"}</h3>
        <button
          disabled={busy}
          onClick={() => void run(async () => setCatalog(await api().catalog(true)))}
        >
          Обновить каталог
        </button>
      </div>
      <small className="muted">
        {catalog?.source === "remote" ? "Каталог GitHub" : "Поставляется с приложением"}
      </small>
      {catalog?.error && (
        <p className="field-help">
          {catalog.error}. Доступны пакеты из текущего каталога.
        </p>
      )}
      {kind === "theme" && (
        <div className="button-row">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (await api().installTheme()) await refreshThemes();
              })
            }
          >
            Импортировать тему…
          </button>
          {preferences.customTheme && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  onPreferences(await api().preferences({ customTheme: null })),
                )
              }
            >
              Стандартная палитра
            </button>
          )}
        </div>
      )}
      <div className="catalog-list">
        {catalog?.entries
          .filter((entry) => entry.kind === kind)
          .map((entry) => {
            const installed =
              kind === "extension"
                ? plugins.find((plugin) => plugin.id === entry.id)
                : themes.find((theme) => theme.id === entry.id);
            const update = installed && newer(entry.version, installed.version),
              theme =
                kind === "theme" ? themes.find((theme) => theme.id === entry.id) : null;
            return (
              <article className="catalog-entry" key={entry.id}>
                <div>
                  <strong>{entry.name}</strong>
                  <small>{entry.description}</small>
                  <small>{entry.version}</small>
                </div>
                <div className="catalog-actions">
                  {(!installed || update) && (
                    <button
                      disabled={busy}
                      aria-label={`${update ? "Обновить" : "Установить"} ${entry.name}`}
                      onClick={() =>
                        void run(async () => {
                          await api().catalogInstall(kind, entry.id);
                          await onInstalled?.();
                          await refreshThemes();
                          onMessage(
                            kind === "extension"
                              ? "Расширение установлено и пока выключено"
                              : "Тема установлена",
                          );
                        })
                      }
                    >
                      {update ? "Обновить" : "Установить"}
                    </button>
                  )}
                  {theme && (
                    <button
                      disabled={busy || preferences.customTheme?.id === theme.id}
                      onClick={() => void run(() => apply(theme))}
                    >
                      {preferences.customTheme?.id === theme.id ? "Выбрана" : "Применить"}
                    </button>
                  )}
                  {kind === "extension" && installed && !update && (
                    <small className="muted">Установлено</small>
                  )}
                  {theme && (
                    <button
                      aria-label={"Удалить тему " + theme.name}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (preferences.customTheme?.id === theme.id)
                            onPreferences(await api().preferences({ customTheme: null }));
                          await api().removeTheme(theme.id);
                          await refreshThemes();
                        })
                      }
                    >
                      Удалить
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      {kind === "theme" &&
        themes
          .filter(
            (theme) =>
              !catalog?.entries.some(
                (entry) => entry.kind === "theme" && entry.id === theme.id,
              ),
          )
          .map((theme) => (
            <article className="catalog-entry" key={theme.id}>
              <strong>{theme.name}</strong>
              <button disabled={busy} onClick={() => void run(() => apply(theme))}>
                Применить
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (preferences.customTheme?.id === theme.id)
                      onPreferences(await api().preferences({ customTheme: null }));
                    await api().removeTheme(theme.id);
                    await refreshThemes();
                  })
                }
              >
                Удалить
              </button>
            </article>
          ))}
    </section>
  );
}
