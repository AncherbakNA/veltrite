import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  defaultHotkeys,
  effectiveHotkeys,
  eventShortcut,
  shortcutLabel,
  type Hotkeys,
} from "../../shared/hotkeys";
import { isMac } from "../ui";

export default function HotkeySettings({
  commands,
  value,
  onChange,
}: {
  commands: { id: string; name: string }[];
  value: Hotkeys;
  onChange: (value: Hotkeys) => Promise<unknown>;
}) {
  const [query, setQuery] = useState(""),
    [recording, setRecording] = useState<string | null>(null),
    [error, setError] = useState("");
  const effective = effectiveHotkeys(value),
    unique = [...new Map(commands.map((command) => [command.id, command])).values()];
  const save = async (next: Hotkeys) => {
    try {
      await onChange(next);
      setRecording(null);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <div className="hotkey-settings">
      <h2>Горячие клавиши</h2>
      <input
        aria-label="Найти горячую клавишу"
        placeholder="Найти команду…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="muted">
        Нажмите «Назначить» и введите сочетание. Escape отменяет ввод. Можно назначить до
        четырёх сочетаний на команду.
      </p>
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {unique
        .filter((command) =>
          command.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
        .map((command) => (
          <div className="hotkey-row" key={command.id}>
            <span>{command.name}</span>
            <div>
              {(effective[command.id] || []).map((shortcut) => (
                <button
                  className="hotkey-chip"
                  key={shortcut}
                  title="Удалить сочетание"
                  onClick={() =>
                    void save({
                      ...value,
                      [command.id]: effective[command.id].filter(
                        (item) => item !== shortcut,
                      ),
                    })
                  }
                >
                  <kbd>{shortcutLabel(shortcut, isMac)}</kbd>
                  <Trash2 size={11} />
                </button>
              ))}
              <button
                className={recording === command.id ? "active" : ""}
                data-hotkey-recording={recording === command.id || undefined}
                autoFocus={recording === command.id}
                onClick={(e) => {
                  setRecording(command.id);
                  setError("");
                  e.currentTarget.focus();
                }}
                onBlur={() => setRecording(null)}
                onKeyDown={(e) => {
                  if (recording !== command.id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setRecording(null);
                    return;
                  }
                  if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
                  const shortcut = eventShortcut(e.nativeEvent, isMac);
                  if (!shortcut) {
                    setError(
                      "Выберите сочетание с ⌘, Ctrl, Alt или функциональную клавишу. Системные сочетания защищены.",
                    );
                    return;
                  }
                  const conflict = unique.find(
                    (other) =>
                      other.id !== command.id && effective[other.id]?.includes(shortcut),
                  );
                  if (conflict) {
                    setError(
                      "Сочетание уже назначено: «" +
                        conflict.name +
                        "». Сначала удалите его у этой команды.",
                    );
                    return;
                  }
                  const previous = effective[command.id] || [];
                  if (previous.length >= 4) {
                    setError("Удалите одно из четырёх сочетаний");
                    return;
                  }
                  void save({
                    ...value,
                    [command.id]: [...new Set([...previous, shortcut])],
                  });
                }}
              >
                {recording === command.id ? "Нажмите клавиши…" : "Назначить"}
              </button>
              {Object.hasOwn(value, command.id) && (
                <button
                  className="icon-button"
                  aria-label={"Сбросить клавиши: " + command.name}
                  title={(defaultHotkeys[command.id] || [])
                    .map((item) => shortcutLabel(item, isMac))
                    .join(", ")}
                  onClick={() => {
                    const next = { ...value };
                    delete next[command.id];
                    void save(next);
                  }}
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
