import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { propertyTypes } from "../../shared/properties";
export default function BaseColumnsSettings({
  order,
  available,
  definitions,
  sizes,
  onOrder,
  onDefinition,
  onSize,
}: {
  order: string[];
  available: string[];
  definitions: Record<string, any>;
  sizes: Record<string, number>;
  onOrder: (order: string[]) => void;
  onDefinition: (key: string, value: Record<string, unknown>) => void;
  onSize: (key: string, size: number) => void;
}) {
  const [query, setQuery] = useState("");
  const move = (index: number, delta: number) => {
    const next = [...order];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onOrder(next);
  };
  return (
    <div className="base-columns-settings">
      <p className="field-help">
        Столбцы отображаются в этом порядке. Название и тип свойства действуют во всех
        представлениях этой базы.
      </p>
      {order.map((key, i) => (
        <div className="base-column-setting" key={key}>
          <strong>{key}</strong>
          <input
            aria-label={"Название столбца " + key}
            placeholder="Название"
            value={definitions[key]?.displayName || ""}
            onChange={(e) =>
              onDefinition(key, { ...definitions[key], displayName: e.target.value })
            }
          />
          <select
            aria-label={"Тип столбца " + key}
            disabled={key.startsWith("file.") || key.startsWith("formula.")}
            value={definitions[key]?.type || ""}
            onChange={(e) =>
              onDefinition(key, { ...definitions[key], type: e.target.value })
            }
          >
            <option value="">Автоматически</option>
            {Object.entries(propertyTypes).map(([type, label]) => (
              <option value={type} key={type}>
                {label}
              </option>
            ))}
          </select>
          <input
            aria-label={"Ширина столбца " + key}
            type="number"
            min={80}
            max={800}
            step={10}
            value={sizes[key] || 180}
            onChange={(e) => onSize(key, Number(e.target.value))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={"Столбец выше " + key}
            disabled={i === 0}
            onClick={() => move(i, -1)}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={"Столбец ниже " + key}
            disabled={i === order.length - 1}
            onClick={() => move(i, 1)}
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={"Скрыть столбец " + key}
            onClick={() => onOrder(order.filter((value) => value !== key))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <input
        className="base-property-search"
        aria-label="Найти свойство для столбца"
        placeholder="Добавить свойство…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="base-property-options">
        {available
          .filter(
            (key) =>
              !order.includes(key) &&
              key.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .slice(0, 100)
          .map((key) => (
            <button
              type="button"
              key={key}
              disabled={order.length >= 100}
              onClick={() => onOrder([...order, key])}
            >
              <Plus size={12} />
              {key}
            </button>
          ))}
      </div>
    </div>
  );
}
