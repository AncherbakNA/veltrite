import {
  displayBaseText,
  displayBaseValue,
  measureBaseValue,
  type BaseDisplayValue,
} from "./base-display";
import { globalBaseFunction } from "./base-functions";
import { createBaseEnvironment, valueString } from "./base-values";
import { matchesFilter, rowEvaluator } from "./bases";
import { coordinates, summarize } from "./summaries";
import type { FileEntry, NoteIndex } from "./types";
export interface BaseQueryInput {
  index: NoteIndex[];
  files: FileEntry[];
  document: Record<string, any>;
  view: Record<string, any>;
  columns: string[];
  filter: string;
  sort: string | null;
  ascending: boolean;
  path: string;
  contextPath?: string;
  types?: Record<string, string>;
}
export interface BasePage {
  order: string[];
  values: { path: string; values: Record<string, BaseDisplayValue> }[];
  warnings: string[];
  summaries: Record<string, BaseDisplayValue>;
  points: { path: string; title: string; coordinates: [number, number] }[];
  groupCounts: Record<string, number>;
}
class BaseBudgetError extends Error {}
export function baseQuery(input: BaseQueryInput) {
  const { index, files, document, view } = input,
    known = new Map(index.map((note) => [note.path, note])),
    warnings = new Set<string>();
  const types = { ...input.types };
  for (const [name, value] of Object.entries(document.properties || {}))
    if ((value as any)?.type) types[name.replace(/^note\./, "")] = (value as any).type;
  const environment = createBaseEnvironment(index, files, input.path, types);
  let budget = 0;
  const accounted = new Map<string, Set<string>>();
  const account = (path: string, property: string, value: unknown) => {
    const seen = accounted.get(path) || new Set<string>();
    if (seen.has(property)) return;
    let bytes: number;
    try {
      bytes = measureBaseValue(value);
    } catch (error: any) {
      throw new BaseBudgetError(error.message);
    }
    budget += bytes;
    if (budget > 32 * 1024 * 1024)
      throw new BaseBudgetError(
        "Вычисленные значения больше 32 МиБ. Ограничьте число строк или столбцов",
      );
    seen.add(property);
    accounted.set(path, seen);
  };
  let rows = files
    .filter((file) => file.kind !== "folder")
    .map((file) => {
      const note: NoteIndex = known.get(file.path) || {
        path: file.path,
        title: file.name.replace(/\.[^.]+$/, ""),
        aliases: [],
        tags: [],
        links: [],
        properties: {},
        headings: [],
        words: 0,
      };
      const evaluator = rowEvaluator(note, file, index, document.formulas || {}, {
        environment,
        thisPath: input.contextPath || input.path,
        types,
        account: (property, value) => account(file.path, property, value),
      });
      const errors = new Map<string, string>();
      const get = (property: string): unknown => {
        try {
          const value = evaluator.get(property);
          account(file.path, property, value);
          return value;
        } catch (error: any) {
          if (error instanceof BaseBudgetError) throw error;
          warnings.add(error.message);
          errors.set(property, error.message);
          return null;
        }
      };
      return { file, note, evaluator, get, errors };
    })
    .filter((row) => {
      if (
        input.filter &&
        ![
          row.note.path,
          row.note.title,
          ...Object.values(row.note.properties).map(String),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(input.filter.toLocaleLowerCase())
      )
        return false;
      try {
        return (
          matchesFilter(document.filters, row.evaluator.evaluate) &&
          matchesFilter(view.filters, row.evaluator.evaluate)
        );
      } catch (error: any) {
        if (error instanceof BaseBudgetError) throw error;
        warnings.add(error.message);
        return true;
      }
    });
  const groupProperty = view.groupBy?.property,
    group = (row: (typeof rows)[number]) =>
      displayBaseText(displayBaseValue(row.get(groupProperty || "note.status")));
  if (groupProperty && Array.isArray(view.groupOrder)) {
    const included = new Set(
      view.groupOrder.map((value: unknown) => displayBaseText(displayBaseValue(value))),
    );
    rows = rows.filter((row) => included.has(group(row)));
  }
  const sorts: { property: string; direction: string }[] = input.sort
    ? [{ property: input.sort, direction: input.ascending ? "ASC" : "DESC" }]
    : Array.isArray(view.sort)
      ? view.sort.slice(0, 10)
      : [{ property: "file.name", direction: "ASC" }];
  const compare = (a: unknown, b: unknown) =>
    typeof a === "number" && typeof b === "number"
      ? a - b
      : a instanceof Date && b instanceof Date
        ? +a - +b
        : valueString(a).localeCompare(valueString(b), "ru", { numeric: true });
  rows.sort((a, b) => {
    if (groupProperty) {
      const ag = group(a),
        bg = group(b),
        order = Array.isArray(view.groupOrder)
          ? view.groupOrder.map((value: unknown) =>
              displayBaseText(displayBaseValue(value)),
            )
          : null;
      const result = order
        ? order.indexOf(ag) - order.indexOf(bg)
        : compare(ag, bg) * (view.groupBy.direction === "DESC" ? -1 : 1);
      if (result) return result;
    }
    for (const sort of sorts) {
      const result =
        compare(a.get(sort.property), b.get(sort.property)) *
        (sort.direction === "DESC" ? -1 : 1);
      if (result) return result;
    }
    return 0;
  });
  if (Number.isInteger(view.limit) && view.limit > 0) rows = rows.slice(0, view.limit);
  const summaries: Record<string, BaseDisplayValue> = Object.create(null);
  for (const [column, type] of Object.entries(view.summaries || {}))
    try {
      summaries[column] = displayBaseValue(
        summarize(
          rows.map((row) => row.get(column)),
          String(type),
          document.summaries || {},
        ),
      );
    } catch (error: any) {
      if (error instanceof BaseBudgetError) throw error;
      summaries[column] = { kind: "error", message: error.message };
    }
  const points =
    view.type === "map"
      ? rows.flatMap((row) => {
          const point = coordinates(
            row.get(view.latitude || "latitude"),
            row.get(view.longitude || "longitude"),
          );
          return point
            ? [{ path: row.note.path, title: row.note.title, coordinates: point }]
            : [];
        })
      : [];
  const groupCounts: Record<string, number> = Object.create(null);
  for (const row of rows) {
    const key = group(row);
    groupCounts[key] = (groupCounts[key] || 0) + 1;
  }
  return {
    page(start: number, size = 200): BasePage {
      if (
        !Number.isInteger(start) ||
        start < 0 ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 500
      )
        throw Error("Некорректная страница базы");
      const columns = [
        ...new Set([
          ...input.columns,
          groupProperty || "note.status",
          ...(view.image ? [view.image] : []),
        ]),
      ];
      return {
        order: rows.map((row) => row.note.path),
        values: rows.slice(start, start + size).map((row) => {
          const values = Object.fromEntries(
            columns.map((column) => {
              const value = row.get(column);
              return [
                column,
                row.errors.has(column)
                  ? ({
                      kind: "error",
                      message: row.errors.get(column)!,
                    } as BaseDisplayValue)
                  : displayBaseValue(value),
              ];
            }),
          );
          if (view.image) {
            const cover = row.get(view.image);
            values.$cover = displayBaseValue(
              cover == null
                ? null
                : globalBaseFunction("image", [Array.isArray(cover) ? cover[0] : cover]),
            );
          }
          return { path: row.note.path, values };
        }),
        warnings: [...warnings].slice(0, 20),
        summaries,
        points,
        groupCounts,
      };
    },
    text: displayBaseText,
  };
}
