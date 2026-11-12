import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useDialogFocus } from "../useDialogFocus";
export interface DialogData {
  title: string;
  description?: string;
  initial?: string;
  placeholder?: string;
  confirm?: string;
  danger?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  input?: boolean;
}
export function Dialog({
  data,
  onClose,
  onError,
}: {
  data: DialogData;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const [value, setValue] = useState(data.initial || ""),
    [busy, setBusy] = useState(false);
  const dialog = useDialogFocus<HTMLFormElement>();
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={data.title}
        className="modal prompt-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await data.onSubmit(value);
            onClose();
          } catch (error: any) {
            onError(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-title">
          <h2>{data.title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>
        {data.description && <p className="muted">{data.description}</p>}
        {data.input !== false && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={data.placeholder}
            required
          />
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className={data.danger ? "danger" : "primary"} disabled={busy}>
            {busy ? "Подождите…" : data.confirm || "Создать"}
          </button>
        </div>
      </form>
    </div>
  );
}
export interface Command {
  id: string;
  name: string;
  hint?: string;
  group?: string;
  run: () => unknown;
}
export function CommandPalette({
  commands,
  onClose,
  placeholder = "Найти команду…",
}: {
  commands: Command[];
  onClose: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const dialog = useDialogFocus<HTMLDivElement>();
  const filtered = commands
    .filter((c) => c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .slice(0, 80);
  const selectedIndex = Math.max(0, Math.min(selected, filtered.length - 1));
  useEffect(() => {
    dialog.current
      ?.querySelector(".command-list .selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, dialog]);
  const invoke = (command: Command) => {
    onClose();
    command.run();
  };
  return (
    <div
      className="overlay palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal palette"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Палитра команд"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((i) => Math.min(i + 1, filtered.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter" && filtered[selectedIndex]) {
            e.preventDefault();
            invoke(filtered[selectedIndex]);
          }
        }}
      >
        <div className="palette-input">
          <Search size={19} />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={placeholder}
          />
          <kbd>esc</kbd>
        </div>
        <div className="command-list">
          {filtered.map((command, i) => (
            <button
              key={command.id}
              className={i === selectedIndex ? "selected" : ""}
              onMouseEnter={() => setSelected(i)}
              onClick={() => invoke(command)}
            >
              <span>{command.name}</span>
              <small>{command.hint || command.group}</small>
            </button>
          ))}
          {!filtered.length && <p className="empty-small">Ничего не найдено</p>}
        </div>
        <div className="palette-footer">
          ↑ ↓ выбрать <span>↵ открыть</span>
        </div>
      </div>
    </div>
  );
}
