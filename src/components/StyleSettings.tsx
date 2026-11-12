import { ArrowDown, ArrowUp, FileCode, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { StyleDefinition } from "../../shared/styles";
import type { Preferences } from "../../shared/types";
import { api } from "../useVault";
export default function StyleSettings({
  preferences,
  onPreferences,
}: {
  preferences: Preferences;
  onPreferences: (preferences: Preferences) => void;
}) {
  const [styles, setStyles] = useState<StyleDefinition[]>([]),
    [editing, setEditing] = useState<StyleDefinition | null>(null),
    [css, setCss] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => api().styles().then(setStyles);
  useEffect(() => {
    void refresh();
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = async (patch: Partial<Preferences>) => {
    onPreferences({ ...preferences, ...patch });
    onPreferences(await api().preferences(patch));
  };
  return (
    <div className="style-settings">
      <h3>CSS-темы и сниппеты</h3>
      <p className="field-help">
        Тема меняет оформление целиком. Сниппеты дополняют её и применяются по порядку
        списка.
      </p>
      <div className="button-row">
        {(
          [
            ["theme", "Установить тему"],
            ["snippet", "Добавить сниппет"],
          ] as const
        ).map(([kind, label]) => (
          <button
            disabled={busy}
            key={kind}
            onClick={() =>
              void run(async () => {
                const value = await api().installStyle(kind);
                if (value) {
                  onPreferences(
                    await api().preferences(
                      kind === "theme"
                        ? { cssTheme: value.id }
                        : { cssSnippets: [...preferences.cssSnippets, value.id] },
                    ),
                  );
                }
              })
            }
          >
            <Plus size={13} />
            {label}
          </button>
        ))}
      </div>
      {[...styles]
        .sort((a, b) =>
          a.kind !== b.kind
            ? a.kind === "theme"
              ? -1
              : 1
            : a.kind === "snippet"
              ? (preferences.cssSnippets.includes(a.id)
                  ? preferences.cssSnippets.indexOf(a.id)
                  : 1000) -
                (preferences.cssSnippets.includes(b.id)
                  ? preferences.cssSnippets.indexOf(b.id)
                  : 1000)
              : a.name.localeCompare(b.name, "ru"),
        )
        .map((style) => (
          <div className="setting-row" key={style.id}>
            <label className="style-toggle">
              <input
                type={style.kind === "theme" ? "radio" : "checkbox"}
                name={style.kind === "theme" ? "css-theme" : undefined}
                checked={
                  style.kind === "theme"
                    ? preferences.cssTheme === style.id
                    : preferences.cssSnippets.includes(style.id)
                }
                disabled={busy}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void run(() =>
                    update(
                      style.kind === "theme"
                        ? { cssTheme: style.id }
                        : {
                            cssSnippets: checked
                              ? [...preferences.cssSnippets, style.id]
                              : preferences.cssSnippets.filter((id) => id !== style.id),
                          },
                    ),
                  );
                }}
              />
              <FileCode size={14} />
              <span>
                {style.name}
                <small>{style.kind === "theme" ? "Тема" : "Сниппет"}</small>
              </span>
            </label>
            {style.kind === "snippet" &&
              preferences.cssSnippets.includes(style.id) &&
              [-1, 1].map((delta) => {
                const position = preferences.cssSnippets.indexOf(style.id),
                  Icon = delta < 0 ? ArrowUp : ArrowDown;
                return (
                  <button
                    className="icon-button"
                    key={delta}
                    disabled={
                      busy ||
                      position + delta < 0 ||
                      position + delta >= preferences.cssSnippets.length
                    }
                    aria-label={
                      (delta < 0 ? "Сниппет выше: " : "Сниппет ниже: ") + style.name
                    }
                    onClick={() =>
                      void run(async () => {
                        const cssSnippets = [...preferences.cssSnippets];
                        [cssSnippets[position], cssSnippets[position + delta]] = [
                          cssSnippets[position + delta],
                          cssSnippets[position],
                        ];
                        await update({ cssSnippets });
                      })
                    }
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            <button
              className="icon-button"
              aria-label={"Править CSS: " + style.name}
              onClick={() => {
                setEditing(style);
                setCss(style.css);
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={"Удалить CSS: " + style.name}
              onClick={() =>
                void run(async () => {
                  onPreferences(
                    await api().preferences({
                      cssTheme:
                        preferences.cssTheme === style.id ? null : preferences.cssTheme,
                      cssSnippets: preferences.cssSnippets.filter(
                        (id) => id !== style.id,
                      ),
                    }),
                  );
                  await api().removeStyle(style.id);
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      {preferences.cssTheme && (
        <button
          className="text-link"
          onClick={() =>
            void run(async () =>
              onPreferences(await api().preferences({ cssTheme: null })),
            )
          }
        >
          Использовать встроенную тему
        </button>
      )}
      {editing && (
        <form
          className="style-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api().saveStyle(editing.id, css);
              onPreferences(
                await api().preferences({ styleRevision: preferences.styleRevision + 1 }),
              );
              setEditing(null);
            });
          }}
        >
          <strong>{editing.name}</strong>
          <textarea
            aria-label="Код CSS"
            spellCheck={false}
            value={css}
            onChange={(e) => setCss(e.target.value)}
          />
          <div className="button-row">
            <button className="primary" disabled={busy}>
              Сохранить CSS
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
