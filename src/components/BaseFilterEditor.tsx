import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { conditionExpression } from "../../shared/base-document";
export default function BaseFilterEditor({
  value,
  onChange,
  properties,
  types,
  depth = 0,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  properties: string[];
  types: Record<string, string>;
  depth?: number;
}) {
  const [adding, setAdding] = useState(false),
    [property, setProperty] = useState(properties[0] || "file.name"),
    [operator, setOperator] = useState("=="),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const group =
    value && typeof value === "object" && !Array.isArray(value)
      ? ["and", "or", "not"].find((key) => Object.hasOwn(value, key))
      : null;
  const children =
    group && Array.isArray((value as any)[group])
      ? ((value as any)[group] as unknown[])
      : [];
  const append = (condition: unknown) =>
    onChange(
      group
        ? { [group]: [...children, condition] }
        : value
          ? { and: [value, condition] }
          : { and: [condition] },
    );
  if (depth > 12)
    return (
      <p className="field-help">Группа глубже 12 уровней. Измените её в исходном коде.</p>
    );
  return (
    <div className="base-filter-editor" style={{ marginLeft: depth ? 14 : 0 }}>
      {typeof value === "string" ? (
        <textarea
          aria-label="Выражение фильтра"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={2}
        />
      ) : group ? (
        <>
          <select
            aria-label="Группа условий"
            value={group}
            onChange={(e) => onChange({ [e.target.value]: children })}
          >
            <option value="and">Все условия</option>
            <option value="or">Хотя бы одно</option>
            <option value="not">Ни одно</option>
          </select>
          {children.map((child, i) => (
            <div className="base-filter-child" key={i}>
              <BaseFilterEditor
                value={child}
                onChange={(next) =>
                  onChange({
                    [group]: children.map((value, index) => (index === i ? next : value)),
                  })
                }
                properties={properties}
                types={types}
                depth={depth + 1}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Удалить условие"
                onClick={() =>
                  onChange({ [group]: children.filter((_, index) => index !== i) })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </>
      ) : (
        <p className="field-help">Ограничений нет</p>
      )}
      {adding && (
        <div className="base-condition-builder">
          <select
            aria-label="Свойство условия"
            value={property}
            onChange={(e) => setProperty(e.target.value)}
          >
            {properties.map((property) => (
              <option key={property}>{property}</option>
            ))}
          </select>
          <select
            aria-label="Оператор условия"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          >
            {Object.entries({
              "==": "Равно",
              "!=": "Не равно",
              ">": "Больше",
              ">=": "Не меньше",
              "<": "Меньше",
              "<=": "Не больше",
              contains: "Содержит",
              empty: "Пусто",
              filled: "Заполнено",
              tag: "Есть тег",
              folder: "В папке",
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {!["empty", "filled"].includes(operator) && (
            <input
              aria-label="Значение условия"
              placeholder="Значение"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          <button
            type="button"
            onClick={() => {
              try {
                append(
                  conditionExpression(
                    property,
                    operator,
                    text,
                    types[property] || types[property.replace(/^note\./, "")],
                  ),
                );
                setAdding(false);
                setError("");
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Добавить
          </button>
        </div>
      )}
      <div className="button-row">
        <button type="button" onClick={() => setAdding((value) => !value)}>
          <Plus size={12} />
          Условие
        </button>
        {depth < 8 && (
          <button type="button" onClick={() => append({ or: [] })}>
            Группа
          </button>
        )}
        <button type="button" onClick={() => append('file.ext == "md"')}>
          Выражение
        </button>
        {value != null && depth === 0 && (
          <button type="button" onClick={() => onChange(null)}>
            Очистить
          </button>
        )}
      </div>
      {error && <p className="save-error">{error}</p>}
    </div>
  );
}
