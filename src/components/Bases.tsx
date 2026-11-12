import { ArrowUpDown, FileText, Filter, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parse as parseYaml, stringify } from "yaml";
import { matchesFilter, rowEvaluator } from "../../shared/bases";
import { frontmatter } from "../../shared/markdown";
import {
  parseProperty,
  propertyType,
  propertyTypes,
  type PropertyType,
} from "../../shared/properties";
import { coordinates, summarize, summaryTypes } from "../../shared/summaries";
import type { FileEntry, NoteIndex } from "../../shared/types";
import { api } from "../useVault";
import BaseMap from "./BaseMap";
import Pagination, { usePagination } from "./Pagination";

function PropertyCheckbox({
  value,
  label,
  onChange,
}: {
  value: boolean;
  label: string;
  onChange: (checked: boolean) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState(value),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setChecked(value);
  }, [value]);
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={busy}
      onChange={async (event) => {
        const next = event.target.checked;
        setChecked(next);
        setBusy(true);
        const saved = await onChange(next);
        if (!saved) setChecked(value);
        setBusy(false);
      }}
    />
  );
}
function display(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString("ru-RU");
  if (Array.isArray(value)) return value.map(display).join(", ");
  return String(value);
}

export default function Bases({
  content,
  index,
  files,
  onOpen,
  onChange,
}: {
  content: string;
  index: NoteIndex[];
  files: FileEntry[];
  onOpen: (path: string) => void;
  onChange: (content: string) => void;
}) {
  const [filter, setFilter] = useState(""),
    [sort, setSort] = useState<string | null>(null),
    [ascending, setAscending] = useState(true),
    [viewIndex, setViewIndex] = useState(0),
    [editing, setEditing] = useState<{ path: string; column: string } | null>(null),
    [error, setError] = useState("");
  const parsed = useMemo(() => {
    const value = parseYaml(content, { maxAliasCount: 20 }) || {};
    if (typeof value !== "object" || Array.isArray(value))
      throw Error("Некорректная база");
    if (value.views !== undefined) {
      if (!Array.isArray(value.views) || value.views.length > 100)
        throw Error("Некорректные представления базы");
      for (const view of value.views) {
        if (
          !view ||
          typeof view !== "object" ||
          Array.isArray(view) ||
          typeof view.type !== "string" ||
          (view.name !== undefined && typeof view.name !== "string")
        )
          throw Error("Некорректное представление");
        if (
          view.order !== undefined &&
          (!Array.isArray(view.order) ||
            view.order.length > 100 ||
            view.order.some((column: unknown) => typeof column !== "string"))
        )
          throw Error("Некорректные столбцы");
      }
    }
    if (
      value.formulas !== undefined &&
      (!value.formulas ||
        typeof value.formulas !== "object" ||
        Array.isArray(value.formulas) ||
        Object.values(value.formulas).some(
          (expression) => typeof expression !== "string",
        ))
    )
      throw Error("Некорректные формулы");
    return value;
  }, [content]);
  const views =
    Array.isArray(parsed.views) && parsed.views.length
      ? parsed.views
      : [{ type: "table", name: "Все заметки" }];
  const view = views[Math.min(viewIndex, views.length - 1)],
    knownViews = ["table", "cards", "list", "kanban", "map"];
  const columns: string[] = Array.isArray(view.order)
    ? view.order
    : [
        "file.name",
        "tags",
        ...new Set(
          index
            .flatMap((n) => Object.keys(n.properties))
            .filter((k) => !["aliases", "tags"].includes(k)),
        ),
        ...Object.keys(parsed.formulas || {}).map((key) => "formula." + key),
      ];
  const { rows, warnings } = useMemo(() => {
    const warnings = new Set<string>(),
      known = new Map(index.map((note) => [note.path, note]));
    let rows = files
      .filter((file) => file.kind !== "folder")
      .map((file) => {
        const note = known.get(file.path) || {
          path: file.path,
          title: file.name.replace(/\.md$/i, ""),
          aliases: [],
          tags: [],
          links: [],
          headings: [],
          properties: {},
          words: 0,
        };
        const evaluator = rowEvaluator(note, file, index, parsed.formulas || {});
        return { note, file, evaluator };
      })
      .filter((row) => {
        if (
          filter &&
          ![
            row.note.title,
            row.note.path,
            ...Object.values(row.note.properties).map(String),
          ]
            .join(" ")
            .toLowerCase()
            .includes(filter.toLowerCase())
        )
          return false;
        try {
          return (
            matchesFilter(parsed.filters, row.evaluator.evaluate) &&
            matchesFilter(view.filters, row.evaluator.evaluate)
          );
        } catch (error: any) {
          warnings.add(error.message);
          return true;
        }
      });
    const property = sort || view.sort?.[0]?.property || "file.name",
      direction = sort
        ? ascending
          ? 1
          : -1
        : view.sort?.[0]?.direction === "DESC"
          ? -1
          : 1;
    rows.sort((a, b) => {
      try {
        const av = a.evaluator.get(property),
          bv = b.evaluator.get(property);
        if (typeof av === "number" && typeof bv === "number")
          return (av - bv) * direction;
        return (
          display(av).localeCompare(display(bv), "ru", { numeric: true }) * direction
        );
      } catch (error: any) {
        warnings.add(error.message);
        return 0;
      }
    });
    if (Number.isInteger(view.limit) && view.limit > 0) rows = rows.slice(0, view.limit);
    return { rows, warnings: [...warnings] };
  }, [files, index, parsed, view, filter, sort, ascending]);
  const pagination = usePagination(
    rows.length,
    JSON.stringify([viewIndex, view.type, filter, sort, ascending]),
  );
  const visibleRows = rows.slice(pagination.start, pagination.start + pagination.size);
  const get = (row: (typeof rows)[number], column: string) => {
    try {
      return display(row.evaluator.get(column));
    } catch (error: any) {
      return "⚠ " + error.message;
    }
  };
  const mapPoints = useMemo(
    () =>
      rows.flatMap((row) => {
        const point = coordinates(
          row.evaluator.get(view.latitude || "latitude"),
          row.evaluator.get(view.longitude || "longitude"),
        );
        return point
          ? [{ path: row.note.path, title: row.note.title, coordinates: point }]
          : [];
      }),
    [rows, view.latitude, view.longitude],
  );
  const setProperty = async (notePath: string, column: string, input: string) => {
    setEditing(null);
    setError("");
    try {
      const property = column.replace(/^note\./, "");
      if (
        property.startsWith("file.") ||
        property.startsWith("formula.") ||
        ["__proto__", "constructor", "prototype"].includes(property)
      )
        return;
      const note = await api().read(notePath),
        { properties, body } = frontmatter(note.content);
      let value: unknown = input;
      try {
        value = parseYaml(input, { maxAliasCount: 10 });
      } catch {}
      const declared =
        parsed.properties?.[column]?.type ||
        parsed.properties?.["note." + property]?.type ||
        parsed.properties?.[property]?.type;
      if (declared && Object.hasOwn(propertyTypes, declared))
        value = parseProperty(
          ["list", "tags"].includes(declared) && Array.isArray(value) ? value : input,
          declared,
        );
      await api().write(
        notePath,
        "---\n" +
          stringify({ ...properties, [property]: value }).trimEnd() +
          "\n---\n" +
          body,
        note.revision,
      );
      return true;
    } catch (error: any) {
      setError(error.message);
      return false;
    }
  };
  const cell = (row: (typeof rows)[number], column: string) => {
    if (column === "file.name")
      return (
        <button className="inline-link" onClick={() => onOpen(row.note.path)}>
          <FileText size={14} />
          {row.note.title}
        </button>
      );
    const editable =
      row.file.kind === "note" &&
      !column.startsWith("file.") &&
      !column.startsWith("formula.");
    const declared = parsed.properties?.[column]?.type;
    const type: PropertyType =
      declared && Object.hasOwn(propertyTypes, declared)
        ? declared
        : editable
          ? propertyType(row.evaluator.get(column))
          : "text";
    if (type === "checkbox" && editable)
      return (
        <PropertyCheckbox
          label={column + ": " + row.note.title}
          value={row.evaluator.get(column) === true}
          onChange={(checked) =>
            setProperty(row.note.path, column, String(checked)).then(Boolean)
          }
        />
      );
    if (editing?.path === row.note.path && editing.column === column)
      return (
        <input
          autoFocus
          aria-label={"Изменить " + column}
          type={
            type === "number"
              ? "number"
              : type === "date"
                ? "date"
                : type === "datetime"
                  ? "datetime-local"
                  : type === "url"
                    ? "url"
                    : "text"
          }
          defaultValue={get(row, column)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(null);
          }}
          onBlur={(event) => setProperty(row.note.path, column, event.target.value)}
        />
      );
    return (
      <div
        className={editable ? "editable-cell" : ""}
        title={editable ? "Двойной щелчок — изменить свойство" : undefined}
        onDoubleClick={() => editable && setEditing({ path: row.note.path, column })}
      >
        {column === "tags"
          ? row.note.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))
          : get(row, column) || <span className="faint">—</span>}
      </div>
    );
  };
  const groupProperty = view.groupBy?.property || "note.status";
  const groups = new Map<string, typeof rows>();
  for (const row of visibleRows) {
    const value = get(row, groupProperty);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value)!.push(row);
  }
  const groupOrder = Array.isArray(view.groupOrder)
    ? view.groupOrder
        .map((v: unknown) => display(v))
        .filter((group: string) => groups.has(group) || rows.length <= pagination.size)
    : [...groups.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  const changeSort = (column: string) => {
    const nextAscending = sort === column ? !ascending : true;
    setSort(column);
    setAscending(nextAscending);
    const next = {
      ...parsed,
      views: views.map((item: any, i: number) =>
        i === viewIndex
          ? {
              ...item,
              sort: [{ property: column, direction: nextAscending ? "ASC" : "DESC" }],
            }
          : item,
      ),
    };
    onChange(stringify(next));
  };
  return (
    <div className="base-view">
      <div className="graph-toolbar">
        <div>
          <Table2 size={20} />
          <select
            aria-label="Представление базы"
            value={viewIndex}
            onChange={(e) => {
              setViewIndex(Number(e.target.value));
              setSort(null);
            }}
          >
            {views.map((item: any, i: number) => (
              <option key={i} value={i}>
                {item.name || "Представление " + (i + 1)}
              </option>
            ))}
          </select>
          <span className="badge">{rows.length}</span>
        </div>
        <div>
          <Filter size={16} />
          <input
            placeholder="Фильтр по названию и свойствам"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      {(warnings.length > 0 || !knownViews.includes(view.type)) && (
        <div className="info-card">
          {!knownViews.includes(view.type)
            ? "Неизвестное представление: показана таблица. "
            : ""}
          {warnings.length > 0
            ? "Часть выражений не поддерживается; затронутые строки оставлены видимыми. " +
              warnings.join("; ")
            : ""}
        </div>
      )}
      {error && <div className="save-error">{error}</div>}
      {view.type !== "map" && <Pagination {...pagination} />}
      {view.type === "map" ? (
        <BaseMap points={mapPoints} onOpen={onOpen} />
      ) : view.type === "cards" || view.type === "list" ? (
        <div className={"base-cards " + (view.type === "list" ? "base-list" : "")}>
          {visibleRows.map((row) => (
            <article className="base-card" key={row.note.path}>
              <button className="base-card-title" onClick={() => onOpen(row.note.path)}>
                <FileText size={17} />
                {row.note.title}
              </button>
              {columns
                .filter((c) => c !== "file.name")
                .map((column) => (
                  <div className="base-card-field" key={column}>
                    <small>
                      {(typeof parsed.properties?.[column]?.displayName === "string"
                        ? parsed.properties[column].displayName
                        : null) || column.replace(/^note\./, "")}
                    </small>
                    {cell(row, column)}
                  </div>
                ))}
            </article>
          ))}
        </div>
      ) : view.type === "kanban" ? (
        <div className="base-kanban">
          {groupOrder.map((group: string) => (
            <section
              className="kanban-column"
              key={group}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const note = event.dataTransfer.getData("text/veltrite-note");
                if (
                  rows.some((row) => row.note.path === note && row.file.kind === "note")
                )
                  setProperty(note, groupProperty, group);
              }}
            >
              <h3>
                {group || "Без группы"}
                <span className="badge">{groups.get(group)?.length || 0}</span>
              </h3>
              {groups.get(group)?.map((row) => (
                <article
                  key={row.note.path}
                  draggable={row.file.kind === "note"}
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/veltrite-note", row.note.path)
                  }
                  className="base-card"
                >
                  <button
                    className="base-card-title"
                    onClick={() => onOpen(row.note.path)}
                  >
                    {row.note.title}
                  </button>
                  {columns
                    .filter((c) => c !== "file.name" && c !== groupProperty)
                    .map((column) => (
                      <div className="base-card-field" key={column}>
                        {cell(row, column)}
                      </div>
                    ))}
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="base-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>
                    <button onClick={() => changeSort(column)}>
                      {(typeof parsed.properties?.[column]?.displayName === "string"
                        ? parsed.properties[column].displayName
                        : null) ||
                        (column === "file.name"
                          ? "Заметка"
                          : column === "tags"
                            ? "Теги"
                            : column.replace(/^note\./, ""))}
                      <ArrowUpDown size={12} />
                    </button>
                    {!column.startsWith("file.") && !column.startsWith("formula.") && (
                      <select
                        className="base-property-type"
                        aria-label={"Тип " + column}
                        value={parsed.properties?.[column]?.type || ""}
                        onChange={(event) => {
                          const next = {
                            ...parsed,
                            properties: {
                              ...parsed.properties,
                              [column]: {
                                ...parsed.properties?.[column],
                                type: event.target.value,
                              },
                            },
                          };
                          onChange(stringify(next));
                        }}
                      >
                        <option value="">Авто</option>
                        {Object.entries(propertyTypes).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.note.path}>
                  {columns.map((column) => (
                    <td key={column}>{cell(row, column)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {columns.map((column) => (
                  <td key={column}>
                    <select
                      aria-label={"Итог " + column}
                      value={view.summaries?.[column] || ""}
                      onChange={(event) =>
                        onChange(
                          stringify({
                            ...parsed,
                            views: views.map((item: unknown, i: number) =>
                              i === viewIndex
                                ? {
                                    ...view,
                                    summaries: {
                                      ...view.summaries,
                                      [column]: event.target.value,
                                    },
                                  }
                                : item,
                            ),
                          }),
                        )
                      }
                    >
                      <option value="">Итог…</option>
                      {Object.entries({
                        ...summaryTypes,
                        ...Object.fromEntries(
                          Object.keys(parsed.summaries || {}).map((key) => [key, key]),
                        ),
                      }).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {view.summaries?.[column] && (
                      <strong className="base-summary">
                        {(() => {
                          try {
                            return display(
                              summarize(
                                rows.map((row) => row.evaluator.get(column)),
                                view.summaries[column],
                                parsed.summaries || {},
                              ),
                            );
                          } catch (error: any) {
                            return "⚠ " + error.message;
                          }
                        })()}
                      </strong>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
