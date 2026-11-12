import { Pencil, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { propertyType, propertyTypes, type PropertyType } from "../../shared/properties";
import type { NoteIndex } from "../../shared/types";
import { useDialogFocus } from "../useDialogFocus";
import { api } from "../useVault";
export default function PropertiesManager({
  index,
  types,
  onTypes,
  onRefresh,
  onOpen,
  onClose,
}: {
  index: NoteIndex[];
  types: Record<string, PropertyType>;
  onTypes: (types: Record<string, PropertyType>) => Promise<unknown>;
  onRefresh: () => Promise<unknown>;
  onOpen: (path: string) => unknown;
  onClose: () => void;
}) {
  const dialog = useDialogFocus<HTMLDivElement>(),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [rename, setRename] = useState(""),
    [operation, setOperation] = useState<"rename" | "delete" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const properties = useMemo(() => {
    const result = new Map<string, NoteIndex[]>();
    for (const note of index)
      for (const key of Object.keys(note.properties)) {
        const entries = result.get(key) || [];
        entries.push(note);
        result.set(key, entries);
      }
    return [...result.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"));
  }, [index]);
  const notes = properties.find(([key]) => key === selected)?.[1] || [];
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Все свойства"
        className="modal metadata-modal"
      >
        <div className="modal-title">
          <h2>Все свойства</h2>
          <button aria-label="Закрыть" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="metadata-columns">
          <div>
            <div className="search-field">
              <Search size={14} />
              <input
                placeholder="Найти свойство…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {properties
              .filter(([key]) =>
                key.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              )
              .map(([key, notes]) => (
                <button
                  className={"simple-row " + (selected === key ? "active" : "")}
                  key={key}
                  onClick={() => {
                    setSelected(key);
                    setOperation(null);
                    setError("");
                  }}
                >
                  <span>{key}</span>
                  <small className="count">{notes.length}</small>
                </button>
              ))}
          </div>
          <div>
            {selected ? (
              <>
                <h3>{selected}</h3>
                <label className="composer-field">
                  Тип свойства
                  <select
                    value={
                      types[selected] || propertyType(notes[0]?.properties[selected])
                    }
                    onChange={(e) =>
                      void run(() =>
                        onTypes({ ...types, [selected]: e.target.value as PropertyType }),
                      )
                    }
                  >
                    {Object.entries(propertyTypes).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="button-row">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setOperation("rename");
                      setRename(selected);
                    }}
                  >
                    <Pencil size={13} />
                    Переименовать
                  </button>
                  <button disabled={busy} onClick={() => setOperation("delete")}>
                    <Trash2 size={13} />
                    Удалить свойство
                  </button>
                </div>
                {operation && (
                  <form
                    className="metadata-operation"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const key = selected;
                        await api().updateProperties(
                          notes.map((note) => note.path),
                          operation === "rename"
                            ? { rename: { from: key, to: rename } }
                            : { remove: [key] },
                        );
                        const nextTypes = { ...types };
                        delete nextTypes[key];
                        if (operation === "rename" && types[key])
                          nextTypes[rename] = types[key];
                        await onTypes(nextTypes);
                        await onRefresh();
                        setSelected(operation === "rename" ? rename : null);
                        setOperation(null);
                      });
                    }}
                  >
                    <p>
                      {operation === "delete"
                        ? `Удалить «${selected}» из ${notes.length} заметок? Предыдущие версии останутся в истории.`
                        : `Переименовать свойство в ${notes.length} заметках.`}
                    </p>
                    {operation === "rename" && (
                      <input
                        aria-label="Новое имя свойства"
                        value={rename}
                        onChange={(e) => setRename(e.target.value)}
                        required
                        autoFocus
                      />
                    )}
                    <div className="button-row">
                      <button
                        type="submit"
                        className={operation === "delete" ? "danger" : "primary"}
                        disabled={busy}
                      >
                        {busy ? "Применяем…" : "Применить"}
                      </button>
                      <button type="button" onClick={() => setOperation(null)}>
                        Отмена
                      </button>
                    </div>
                  </form>
                )}
                <span className="eyebrow section-spaced">Заметки со свойством</span>
                {notes.map((note) => (
                  <button
                    className="simple-row"
                    key={note.path}
                    onClick={() => {
                      onOpen(note.path);
                      onClose();
                    }}
                  >
                    {note.path.replace(/\.md$/i, "")}
                  </button>
                ))}
              </>
            ) : (
              <p className="muted">
                Выберите свойство, чтобы увидеть заметки и изменить его имя или тип.
              </p>
            )}
          </div>
        </div>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
