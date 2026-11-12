import { ArrowUpDown, FileText, Filter, SlidersHorizontal, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parse as parseYaml } from "yaml";
import { displayBaseText, type BaseDisplayValue } from "../../shared/base-display";
import { writeBaseDocument } from "../../shared/base-document";
import { editFrontmatter } from "../../shared/frontmatter-edit";
import {
  parseProperty,
  propertyType,
  propertyTypes,
  type PropertyType,
} from "../../shared/properties";
import { summaryTypes } from "../../shared/summaries";
import { formatDate } from "../../shared/templates";
import type { FileEntry, NoteIndex } from "../../shared/types";
import { useBaseQuery } from "../useBaseQuery";
import { api } from "../useVault";
import BaseMap from "./BaseMap";
import BaseSettings from "./BaseSettings";
import BaseValue from "./BaseValue";
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
const display = (value: unknown) => displayBaseText(value as BaseDisplayValue);

export default function Bases({
  content,
  index,
  files,
  onOpen,
  onChange,
  path = "",
  contextPath,
  types = {},
  onLink,
  beforePropertyChange,
  initialView,
  readOnlyDefinition = false,
}: {
  content: string;
  path?: string;
  contextPath?: string;
  initialView?: string;
  readOnlyDefinition?: boolean;
  types?: Record<string, string>;
  onLink?: (target: string, from: string) => void;
  beforePropertyChange?: () => Promise<unknown>;
  index: NoteIndex[];
  files: FileEntry[];
  onOpen: (path: string) => void;
  onChange: (content: string) => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const writeConfiguration = (next: Record<string, any>) =>
    writeBaseDocument(content, next);
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
  const views = useMemo(
    () =>
      Array.isArray(parsed.views) && parsed.views.length
        ? parsed.views
        : [{ type: "table", name: "Все заметки" }],
    [parsed],
  );
  useEffect(() => {
    if (initialView) {
      const position = views.findIndex((view: any) => view.name === initialView);
      if (position >= 0) setViewIndex(position);
    }
  }, [initialView, views]);
  const view = views[Math.min(viewIndex, views.length - 1)],
    knownViews = ["table", "cards", "list", "kanban", "map"];
  const columns: string[] = (
    Array.isArray(view.order)
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
        ]
  ).slice(0, 100);
  const [total, setTotal] = useState(0);
  const pagination = usePagination(
    total,
    JSON.stringify([viewIndex, view.type, filter, sort, ascending]),
  );
  const query = useBaseQuery(
    {
      index,
      files,
      document: parsed,
      view,
      columns: columns.slice(0, 100),
      filter,
      sort,
      ascending,
      path,
      contextPath,
      types,
    },
    pagination.start,
    pagination.size,
  );
  useEffect(() => setTotal(query.data.order.length), [query.data.order.length]);
  const metadata = useMemo(() => {
    const notes = new Map(index.map((note) => [note.path, note]));
    const entries = new Map(files.map((file) => [file.path, file]));
    for (const file of files)
      if (file.kind !== "folder" && !notes.has(file.path))
        notes.set(file.path, {
          path: file.path,
          title: file.name.replace(/\.[^.]+$/, ""),
          aliases: [],
          tags: [],
          links: [],
          properties: {},
          headings: [],
          words: 0,
        });
    return { notes, entries };
  }, [index, files]);
  const rows = useMemo(() => {
    const values = new Map(query.data.values.map((row) => [row.path, row.values]));
    return query.data.order
      .filter((path) => metadata.entries.has(path))
      .map((path) => ({
        note: metadata.notes.get(path)!,
        file: metadata.entries.get(path)!,
        evaluator: { get: (column: string) => values.get(path)?.[column] },
      }));
  }, [query.data, metadata]);
  const warnings = query.data.warnings;
  const visibleRows = rows.slice(pagination.start, pagination.start + pagination.size);
  const get = (row: (typeof rows)[number], column: string) =>
    display(row.evaluator.get(column));
  const mapPoints = query.data.points;
  const setProperty = async (notePath: string, column: string, input: string) => {
    setEditing(null);
    setError("");
    try {
      if (query.loading) return false;
      const property = column.replace(/^note\./, "");
      if (
        property.startsWith("file.") ||
        property.startsWith("formula.") ||
        ["__proto__", "constructor", "prototype"].includes(property)
      )
        return;
      await beforePropertyChange?.();
      const note = await api().read(notePath);
      let value: unknown = input;
      try {
        value = parseYaml(input, { maxAliasCount: 10 });
      } catch {}
      const declared =
        parsed.properties?.[column]?.type ||
        parsed.properties?.["note." + property]?.type ||
        parsed.properties?.[property]?.type ||
        types[property];
      if (declared && Object.hasOwn(propertyTypes, declared))
        value = parseProperty(
          ["list", "tags"].includes(declared) && Array.isArray(value) ? value : input,
          declared,
        );
      await api().write(
        notePath,
        editFrontmatter(note.content, { set: { [property]: value } }),
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
      !query.loading &&
      row.file.kind === "note" &&
      !column.startsWith("file.") &&
      !column.startsWith("formula.");
    const declared =
      parsed.properties?.[column]?.type ||
      parsed.properties?.[column.replace(/^note\./, "")]?.type ||
      types[column.replace(/^note\./, "")];
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
          defaultValue={(() => {
            const raw = row.note.properties[column.replace(/^note\./, "")];
            if (raw == null) return "";
            if (type === "date") return String(raw).slice(0, 10);
            if (type === "datetime") {
              const date = new Date(String(raw));
              return Number.isFinite(+date) ? formatDate(date, "YYYY-MM-DDTHH:mm") : "";
            }
            return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
          })()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(null);
          }}
          onChange={(event) => {
            event.currentTarget.dataset.edited = "true";
          }}
          onBlur={(event) => {
            if (event.currentTarget.dataset.edited === "true")
              void setProperty(row.note.path, column, event.target.value);
            else setEditing(null);
          }}
        />
      );
    return (
      <div
        className={editable ? "editable-cell" : ""}
        title={editable ? "Двойной щелчок — изменить свойство" : undefined}
        onDoubleClick={() => editable && setEditing({ path: row.note.path, column })}
      >
        {column === "tags" ? (
          row.note.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <BaseValue
            value={row.evaluator.get(column)}
            from={row.note.path}
            onOpen={onOpen}
            onLink={onLink}
          />
        )}
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
    onChange(writeConfiguration(next));
  };
  return (
    <div className="base-view">
      {query.loading && (
        <small className="base-loading" role="status" data-render-pending>
          Вычисляем представление…
        </small>
      )}
      {query.error && (
        <div className="save-error" role="alert">
          {query.error}
        </div>
      )}
      {configuring && (
        <BaseSettings
          content={content}
          document={parsed}
          initialView={viewIndex}
          defaultColumns={columns}
          index={index}
          types={types}
          onClose={() => setConfiguring(false)}
          onApply={(document, selected) => {
            onChange(writeConfiguration(document));
            setViewIndex(selected);
            setSort(null);
          }}
        />
      )}
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
          <button
            disabled={readOnlyDefinition}
            aria-label="Настроить базу"
            title="Настроить базу"
            onClick={() => setConfiguring(true)}
          >
            <SlidersHorizontal size={16} />
          </button>
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
        <div
          className={"base-cards " + (view.type === "list" ? "base-list" : "")}
          style={
            view.type === "cards"
              ? {
                  gridTemplateColumns: `repeat(auto-fill,minmax(${Math.max(160, Math.min(500, Number(view.cardSize) || 240))}px,1fr))`,
                }
              : undefined
          }
        >
          {visibleRows.map((row) => (
            <article className="base-card" key={row.note.path}>
              {view.type === "cards" && row.evaluator.get("$cover") && (
                <div className="base-card-cover">
                  <BaseValue
                    value={row.evaluator.get("$cover")}
                    from={row.note.path}
                    onOpen={onOpen}
                    onLink={onLink}
                  />
                </div>
              )}
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
                <span className="badge">
                  {query.data.groupCounts[group] || groups.get(group)?.length || 0}
                </span>
              </h3>
              {groups.get(group)?.map((row) => (
                <article
                  key={row.note.path}
                  draggable={
                    !query.loading &&
                    row.file.kind === "note" &&
                    !groupProperty.startsWith("file.") &&
                    !groupProperty.startsWith("formula.")
                  }
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
                  <th
                    key={column}
                    style={
                      view.columnSize?.[column]
                        ? {
                            width: Math.max(
                              80,
                              Math.min(800, Number(view.columnSize[column]) || 180),
                            ),
                            minWidth: Math.max(
                              80,
                              Math.min(800, Number(view.columnSize[column]) || 180),
                            ),
                          }
                        : undefined
                    }
                  >
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
                        disabled={readOnlyDefinition}
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
                          onChange(writeConfiguration(next));
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
                      disabled={readOnlyDefinition}
                      aria-label={"Итог " + column}
                      value={view.summaries?.[column] || ""}
                      onChange={(event) =>
                        onChange(
                          writeConfiguration({
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
                        {display(query.data.summaries[column])}
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
