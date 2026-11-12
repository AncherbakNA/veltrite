import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  defaultGraphOptions,
  validateGraphOptions,
  type GraphOptions,
} from "../../shared/graph-options";
export default function GraphSettings({
  options,
  onChange,
}: {
  options: GraphOptions;
  onChange: (options: GraphOptions) => void;
}) {
  const [draft, setDraft] = useState(options),
    [error, setError] = useState("");
  return (
    <form
      className="graph-settings"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onChange(validateGraphOptions(draft));
          setError("");
        } catch (e: any) {
          setError(e.message);
        }
      }}
    >
      <div className="graph-settings-fields">
        <label>
          Глубина локального графа
          <input
            type="number"
            min={1}
            max={10}
            value={draft.depth}
            onChange={(e) => setDraft({ ...draft, depth: Number(e.target.value) })}
          />
        </label>
        <label>
          Направление связей
          <select
            value={draft.direction}
            onChange={(e) =>
              setDraft({
                ...draft,
                direction: e.target.value as GraphOptions["direction"],
              })
            }
          >
            <option value="both">В обе стороны</option>
            <option value="incoming">Входящие</option>
            <option value="outgoing">Исходящие</option>
          </select>
        </label>
        {(
          [
            ["orphans", "Изолированные заметки"],
            ["tags", "Теги"],
            ["attachments", "Вложения"],
            ["unresolved", "Несозданные заметки"],
            ["arrows", "Стрелки"],
            ["labels", "Подписи узлов"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="graph-check">
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        {(
          [
            ["nodeScale", "Размер узлов", 0.25, 4, 0.25],
            ["linkScale", "Толщина связей", 0.25, 4, 0.25],
            ["charge", "Отталкивание", 0, 1000, 10],
            ["distance", "Длина связей", 10, 500, 5],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key}>
            {label}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
            />
            <small>{draft[key]}</small>
          </label>
        ))}
      </div>
      <strong>Цветовые группы</strong>
      <p className="field-help">
        Запросы как в поиске: tag:проект, path:Работа, [status:active]. При совпадении
        действует первая группа.
      </p>
      {draft.groups.map((group, i) => (
        <div className="graph-color-group" key={i}>
          <input
            aria-label={"Запрос группы " + (i + 1)}
            placeholder="tag:проект"
            value={group.query}
            onChange={(e) =>
              setDraft({
                ...draft,
                groups: draft.groups.map((value, index) =>
                  index === i ? { ...value, query: e.target.value } : value,
                ),
              })
            }
          />
          <input
            type="color"
            aria-label={"Цвет группы " + (i + 1)}
            value={group.color}
            onChange={(e) =>
              setDraft({
                ...draft,
                groups: draft.groups.map((value, index) =>
                  index === i ? { ...value, color: e.target.value } : value,
                ),
              })
            }
          />
          <button
            type="button"
            aria-label="Удалить группу"
            onClick={() =>
              setDraft({
                ...draft,
                groups: draft.groups.filter((_, index) => index !== i),
              })
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="button-row">
        <button
          type="button"
          disabled={draft.groups.length >= 30}
          onClick={() =>
            setDraft({
              ...draft,
              groups: [...draft.groups, { query: "", color: "#b99871" }],
            })
          }
        >
          <Plus size={13} />
          Группа
        </button>
        <button type="button" onClick={() => setDraft(defaultGraphOptions)}>
          Сбросить
        </button>
        <button className="primary">Применить</button>
      </div>
      {error && <p className="save-error">{error}</p>}
    </form>
  );
}
