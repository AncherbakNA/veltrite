import { ArrowRight, X } from "lucide-react";
import { useState } from "react";
import type { ComposeRequest } from "../../shared/composer";
import type { EditorSnapshot } from "../editorInsertion";
import { useDialogFocus } from "../useDialogFocus";
import { api } from "../useVault";

export interface ComposerState {
  operation: "extract" | "merge";
  source: string;
  snapshot: EditorSnapshot;
}
export default function NoteComposer({
  state,
  paths,
  onClose,
  onSubmit,
}: {
  state: ComposerState;
  paths: string[];
  onClose: () => void;
  onSubmit: (request: ComposeRequest) => Promise<void>;
}) {
  const [target, setTarget] = useState(""),
    [placement, setPlacement] = useState<"append" | "prepend">("append"),
    [replacement, setReplacement] = useState<"link" | "embed" | "none">(
      state.operation === "extract" ? "link" : "none",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const focus = useDialogFocus<HTMLFormElement>();
  const destination = target.trim().replace(/\.md$/i, "") + ".md",
    exists = paths.includes(destination);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (!busy && e.currentTarget === e.target) onClose();
      }}
    >
      <form
        ref={focus}
        className="modal prompt-modal composer-modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          state.operation === "extract" ? "Извлечь текст в заметку" : "Объединить заметки"
        }
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const source = await api().read(state.source);
            if (source.content !== state.snapshot.content)
              throw Error(
                "Текст исходной заметки изменился. Закройте окно и повторите действие",
              );
            const target = exists ? await api().read(destination) : null;
            await onSubmit({
              operation: state.operation,
              source: state.source,
              sourceRevision: source.revision,
              target: destination,
              ...(target ? { targetRevision: target.revision } : {}),
              placement,
              replacement,
              from: state.snapshot.from,
              to: state.snapshot.to,
            });
            onClose();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-title">
          <h2>
            {state.operation === "extract" ? "Извлечь текст" : "Объединить заметки"}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="muted">
          {state.source} <ArrowRight size={14} />{" "}
          {exists ? "В существующую заметку" : "В новую заметку"}
        </p>
        <label className="composer-field">
          Целевая заметка
          <input
            autoFocus
            required
            list="composer-destinations"
            placeholder="Папка/Название заметки"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
          />
        </label>
        <datalist id="composer-destinations">
          {paths
            .filter((path) => path !== state.source)
            .map((path) => (
              <option key={path} value={path} />
            ))}
        </datalist>
        {exists && (
          <label className="composer-field">
            Куда добавить текст
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value as typeof placement)}
            >
              <option value="append">В конец заметки</option>
              <option value="prepend">В начало после свойств</option>
            </select>
          </label>
        )}
        <label className="composer-field">
          {state.operation === "extract" ? "Заменить выделение" : "Исходная заметка"}
          <select
            value={replacement}
            onChange={(e) => setReplacement(e.target.value as typeof replacement)}
          >
            <option value="link">Оставить ссылку</option>
            <option value="embed">Оставить встроенную заметку</option>
            <option value="none">
              {state.operation === "extract"
                ? "Удалить выделение"
                : "Переместить в корзину"}
            </option>
          </select>
        </label>
        {state.operation === "extract" && (
          <pre className="composer-preview">
            {state.snapshot.content
              .slice(state.snapshot.from, state.snapshot.to)
              .slice(0, 2000)}
          </pre>
        )}
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="primary"
            disabled={busy || !target.trim() || destination === state.source}
          >
            {busy
              ? "Переносим…"
              : state.operation === "extract"
                ? "Извлечь"
                : "Объединить"}
          </button>
        </div>
      </form>
    </div>
  );
}
