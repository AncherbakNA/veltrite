import { Copy, Plus, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { baseViewNames, validateBaseFilters } from "../../shared/base-document";
import { parseFormula } from "../../shared/base-syntax";
import { summaryTypes } from "../../shared/summaries";
import type { NoteIndex } from "../../shared/types";
import { useDialogFocus } from "../useDialogFocus";
import BaseColumnsSettings from "./BaseColumnsSettings";
import BaseFilterEditor from "./BaseFilterEditor";
import BaseFormulaSettings from "./BaseFormulaSettings";
const fileProperties = [
  "file.name",
  "file.basename",
  "file.path",
  "file.folder",
  "file.ext",
  "file.size",
  "file.ctime",
  "file.mtime",
  "file.tags",
  "file.links",
  "file.backlinks",
  "file.embeds",
];
export default function BaseSettings({
  content,
  document,
  initialView,
  defaultColumns,
  index,
  types,
  onClose,
  onApply,
}: {
  content: string;
  document: Record<string, any>;
  initialView: number;
  defaultColumns: string[];
  index: NoteIndex[];
  types: Record<string, string>;
  onClose: () => void;
  onApply: (document: Record<string, any>, view: number) => void;
}) {
  const focus = useDialogFocus<HTMLFormElement>(),
    original = useRef(content);
  const [draft, setDraft] = useState<Record<string, any>>(() => ({
      ...structuredClone(document),
      views: document.views?.length
        ? structuredClone(document.views)
        : [{ name: "Все заметки", type: "table" }],
    })),
    [selected, setSelected] = useState(initialView),
    [tab, setTab] = useState("view"),
    [error, setError] = useState("");
  const view = draft.views[Math.min(selected, draft.views.length - 1)];
  const columns: string[] = Array.isArray(view.order) ? view.order : defaultColumns;
  const available = useMemo(
    () =>
      [
        ...new Set([
          ...fileProperties,
          "tags",
          ...index
            .flatMap((note) => Object.keys(note.properties))
            .map((key) => "note." + key),
          ...Object.keys(draft.formulas || {}).map((key) => "formula." + key),
          ...Object.keys(draft.properties || {}),
          ...columns,
        ]),
      ].sort((a, b) => a.localeCompare(b, "ru")),
    [index, draft.formulas, draft.properties, columns],
  );
  const schema = {
    "file.size": "number",
    "file.ctime": "datetime",
    "file.mtime": "datetime",
    ...types,
    ...Object.fromEntries(
      Object.entries(draft.properties || {}).map(([key, value]) => [
        key,
        (value as any)?.type,
      ]),
    ),
  };
  const patchView = (patch: Record<string, unknown>) =>
    setDraft({
      ...draft,
      views: draft.views.map((value: any, i: number) =>
        i === selected ? { ...value, ...patch } : value,
      ),
    });
  const newView = (copy = false) => {
    const views = [...draft.views],
      template = copy ? structuredClone(view) : { type: "table", order: [...columns] };
    views.push({
      ...template,
      name: (copy ? view.name + " · копия" : "Представление") + " " + (views.length + 1),
    });
    setDraft({ ...draft, views });
    setSelected(views.length - 1);
  };
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        ref={focus}
        className="modal base-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Настройка базы"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            if (original.current !== content)
              throw Error(
                "База изменилась, пока были открыты настройки. Закройте окно и откройте его снова",
              );
            validateBaseFilters(draft.filters);
            for (const [name, expression] of Object.entries(draft.formulas || {})) {
              if (
                !name.trim() ||
                name.length > 150 ||
                ["__proto__", "constructor", "prototype"].includes(name)
              )
                throw Error("Некорректное имя формулы");
              parseFormula(String(expression));
            }
            for (const expression of Object.values(draft.summaries || {}))
              parseFormula(String(expression));
            for (const item of draft.views) {
              if (!item.name?.trim()) throw Error("Укажите название представления");
              validateBaseFilters(item.filters);
              for (const size of Object.values(item.columnSize || {}))
                if (
                  typeof size !== "number" ||
                  !Number.isFinite(size) ||
                  size < 80 ||
                  size > 800
                )
                  throw Error("Ширина столбца должна быть от 80 до 800");
              if (item.order?.length > 100)
                throw Error("Можно отобразить до 100 столбцов");
              if (
                item.limit !== undefined &&
                (!Number.isInteger(item.limit) || item.limit < 0)
              )
                throw Error("Число строк должно быть целым и неотрицательным");
            }
            onApply(draft, selected);
            onClose();
          } catch (error: any) {
            setError(error.message);
          }
        }}
      >
        <div className="modal-title">
          <h2>Настройка базы</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть настройку базы"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="base-view-selector">
          <select
            aria-label="Настраиваемое представление"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {draft.views.map((view: any, i: number) => (
              <option value={i} key={i}>
                {view.name || "Представление " + (i + 1)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Добавить представление"
            disabled={draft.views.length >= 100}
            onClick={() => newView()}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            aria-label="Дублировать представление"
            disabled={draft.views.length >= 100}
            onClick={() => newView(true)}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            aria-label="Удалить представление"
            disabled={draft.views.length < 2}
            onClick={() => {
              setDraft({
                ...draft,
                views: draft.views.filter((_: unknown, i: number) => i !== selected),
              });
              setSelected(Math.max(0, selected - 1));
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="base-settings-tabs">
          {[
            ["view", "Представление"],
            ["columns", "Столбцы"],
            ["filters", "Фильтры"],
            ["formulas", "Формулы"],
            ["summaries", "Итоги"],
          ].map(([key, title]) => (
            <button
              type="button"
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {title}
            </button>
          ))}
        </div>
        <div className="base-settings-body">
          {tab === "view" && (
            <>
              <label className="composer-field">
                Название
                <input
                  aria-label="Название представления"
                  value={view.name || ""}
                  onChange={(e) => patchView({ name: e.target.value })}
                />
              </label>
              <label className="composer-field">
                Вид
                <select
                  aria-label="Вид представления"
                  value={view.type}
                  onChange={(e) => patchView({ type: e.target.value })}
                >
                  {!baseViewNames[view.type] && (
                    <option value={view.type}>{view.type}</option>
                  )}
                  {Object.entries(baseViewNames).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="composer-field">
                Максимум строк · 0 — все
                <input
                  aria-label="Максимум строк"
                  type="number"
                  min={0}
                  value={view.limit || 0}
                  onChange={(e) => patchView({ limit: Number(e.target.value) })}
                />
              </label>
              <h3>Сортировка</h3>
              {(view.sort || []).map((sort: any, i: number) => (
                <div className="base-sort-row" key={i}>
                  <select
                    aria-label={"Свойство сортировки " + (i + 1)}
                    value={sort.property}
                    onChange={(e) =>
                      patchView({
                        sort: view.sort.map((value: any, index: number) =>
                          index === i ? { ...value, property: e.target.value } : value,
                        ),
                      })
                    }
                  >
                    {available.map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </select>
                  <select
                    aria-label={"Направление сортировки " + (i + 1)}
                    value={sort.direction || "ASC"}
                    onChange={(e) =>
                      patchView({
                        sort: view.sort.map((value: any, index: number) =>
                          index === i ? { ...value, direction: e.target.value } : value,
                        ),
                      })
                    }
                  >
                    <option value="ASC">По возрастанию</option>
                    <option value="DESC">По убыванию</option>
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Убрать сортировку"
                    onClick={() =>
                      patchView({
                        sort: view.sort.filter(
                          (_: unknown, index: number) => index !== i,
                        ),
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={(view.sort?.length || 0) >= 10}
                onClick={() =>
                  patchView({
                    sort: [
                      ...(view.sort || []),
                      { property: columns[0] || "file.name", direction: "ASC" },
                    ],
                  })
                }
              >
                Добавить сортировку
              </button>
              <h3>Группировка</h3>
              <label className="composer-field">
                Свойство
                <select
                  aria-label="Свойство группировки"
                  value={view.groupBy?.property || ""}
                  onChange={(e) =>
                    patchView({
                      groupBy: e.target.value
                        ? {
                            property: e.target.value,
                            direction: view.groupBy?.direction || "ASC",
                          }
                        : undefined,
                      groupOrder: undefined,
                    })
                  }
                >
                  <option value="">Без группировки</option>
                  {available.map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
              </label>
              {view.groupBy && (
                <>
                  <select
                    aria-label="Порядок групп"
                    value={view.groupBy.direction || "ASC"}
                    onChange={(e) =>
                      patchView({
                        groupBy: { ...view.groupBy, direction: e.target.value },
                      })
                    }
                  >
                    <option value="ASC">Группы по возрастанию</option>
                    <option value="DESC">Группы по убыванию</option>
                  </select>
                  <label className="setting-row">
                    <span>Задать порядок и видимость групп</span>
                    <input
                      type="checkbox"
                      checked={Array.isArray(view.groupOrder)}
                      onChange={(e) =>
                        patchView({ groupOrder: e.target.checked ? [] : undefined })
                      }
                    />
                  </label>
                  {Array.isArray(view.groupOrder) && (
                    <textarea
                      aria-label="Порядок и видимость групп"
                      placeholder="Одна группа на строку; null — без значения"
                      value={view.groupOrder
                        .map((value: unknown) =>
                          value === null ? "null" : String(value),
                        )
                        .join("\n")}
                      onChange={(e) =>
                        patchView({
                          groupOrder: e.target.value
                            ? e.target.value
                                .split("\n")
                                .map((value) => (value === "null" ? null : value))
                            : [],
                        })
                      }
                    />
                  )}
                </>
              )}
              {view.type === "cards" && (
                <>
                  <label className="composer-field">
                    Свойство обложки
                    <select
                      aria-label="Свойство обложки"
                      value={view.image || ""}
                      onChange={(e) => patchView({ image: e.target.value || undefined })}
                    >
                      <option value="">Без обложки</option>
                      {available.map((key) => (
                        <option key={key}>{key}</option>
                      ))}
                    </select>
                  </label>
                  <label className="composer-field">
                    Ширина карточки
                    <input
                      type="range"
                      min={160}
                      max={500}
                      step={10}
                      value={view.cardSize || 240}
                      onChange={(e) => patchView({ cardSize: Number(e.target.value) })}
                    />
                  </label>
                </>
              )}
              {view.type === "map" && (
                <>
                  <label className="composer-field">
                    Широта
                    <select
                      aria-label="Свойство широты"
                      value={view.latitude || "latitude"}
                      onChange={(e) => patchView({ latitude: e.target.value })}
                    >
                      {[...new Set(["latitude", ...available])].map((key) => (
                        <option key={key}>{key}</option>
                      ))}
                    </select>
                  </label>
                  <label className="composer-field">
                    Долгота
                    <select
                      aria-label="Свойство долготы"
                      value={view.longitude || "longitude"}
                      onChange={(e) => patchView({ longitude: e.target.value })}
                    >
                      {[...new Set(["longitude", ...available])].map((key) => (
                        <option key={key}>{key}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}
          {tab === "columns" && (
            <BaseColumnsSettings
              order={columns}
              available={available}
              definitions={draft.properties || {}}
              sizes={view.columnSize || {}}
              onOrder={(order) => patchView({ order })}
              onDefinition={(key, value) =>
                setDraft({ ...draft, properties: { ...draft.properties, [key]: value } })
              }
              onSize={(key, size) =>
                patchView({ columnSize: { ...view.columnSize, [key]: size } })
              }
            />
          )}
          {tab === "filters" && (
            <>
              <h3>Во всех представлениях</h3>
              <BaseFilterEditor
                value={draft.filters}
                onChange={(filters) => setDraft({ ...draft, filters })}
                properties={available}
                types={schema}
              />
              <h3>В этом представлении</h3>
              <BaseFilterEditor
                value={view.filters}
                onChange={(filters) => patchView({ filters })}
                properties={available}
                types={schema}
              />
            </>
          )}
          {tab === "formulas" && (
            <BaseFormulaSettings document={draft} onChange={setDraft} />
          )}
          {tab === "summaries" && (
            <>
              <p className="field-help">
                Итоги учитывают все строки после фильтрации, включая другие страницы.
              </p>
              {columns.map((column) => (
                <label className="setting-row" key={column}>
                  <span>{column}</span>
                  <select
                    aria-label={"Итог для " + column}
                    value={view.summaries?.[column] || ""}
                    onChange={(e) =>
                      patchView({
                        summaries: { ...view.summaries, [column]: e.target.value },
                      })
                    }
                  >
                    <option value="">Без итога</option>
                    {Object.entries(summaryTypes).map(([key, title]) => (
                      <option key={key} value={key}>
                        {title}
                      </option>
                    ))}
                    {Object.keys(draft.summaries || {}).map((key) => (
                      <option key={key}>{key}</option>
                    ))}
                  </select>
                </label>
              ))}
              <h3>Свои итоги</h3>
              {Object.entries(draft.summaries || {}).map(([key, expression]) => (
                <div className="base-custom-summary" key={key}>
                  <label>{key}</label>
                  <textarea
                    aria-label={"Формула итога " + key}
                    value={String(expression)}
                    spellCheck={false}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        summaries: { ...draft.summaries, [key]: e.target.value },
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label={"Удалить итог " + key}
                    onClick={() => {
                      const summaries = { ...draft.summaries };
                      delete summaries[key];
                      setDraft({ ...draft, summaries });
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  let key = "мой_итог",
                    suffix = 2;
                  while (Object.hasOwn(draft.summaries || {}, key))
                    key = "мой_итог_" + suffix++;
                  setDraft({
                    ...draft,
                    summaries: { ...draft.summaries, [key]: "values.mean()" },
                  });
                }}
              >
                Добавить свой итог
              </button>
            </>
          )}
        </div>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary">Сохранить настройки базы</button>
        </div>
      </form>
    </div>
  );
}
