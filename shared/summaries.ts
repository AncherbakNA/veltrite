import { BaseDuration, emptyValue, parseBaseDate, valueKey } from "./base-values";
import { evaluateExpression } from "./bases";
import { formatDate } from "./templates";
export const summaryTypes: Record<string, string> = {
  CountAll: "Количество",
  CountValues: "Заполнено",
  Empty: "Пусто",
  Unique: "Уникальных",
  Sum: "Сумма",
  Average: "Среднее",
  Stddev: "Среднеквадратичное отклонение",
  Filled: "Заполнено",
  Median: "Медиана",
  Min: "Минимум",
  Max: "Максимум",
  Range: "Размах",
  Earliest: "Ранняя дата",
  Latest: "Поздняя дата",
  Checked: "Отмечено",
  Unchecked: "Не отмечено",
  PercentChecked: "Доля отмеченных",
};
export function summarize(
  values: unknown[],
  type: string,
  custom: Record<string, string> = {},
): unknown {
  const present = values.filter((v) => !emptyValue(v)),
    numbers = present.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
  if (Object.hasOwn(custom, type)) return evaluateExpression(custom[type], { values });
  if (type === "CountAll") return values.length;
  if (type === "CountValues" || type === "Filled") return present.length;
  if (type === "Empty") return values.length - present.length;
  if (type === "Unique") return new Set(present.map((v) => valueKey(v))).size;
  if (type === "Checked") return values.filter((v) => v === true).length;
  if (type === "Unchecked") return values.filter((v) => v === false).length;
  if (type === "PercentChecked")
    return values.length
      ? Math.round((values.filter((v) => v === true).length / values.length) * 10000) /
          100 +
          "%"
      : "0%";
  if (type === "Earliest" || type === "Latest") {
    const dates = present
      .map((value) => {
        try {
          return +parseBaseDate(value);
        } catch {
          return NaN;
        }
      })
      .filter(Number.isFinite);
    return dates.length
      ? formatDate(
          new Date((type === "Earliest" ? Math.min : Math.max)(...dates)),
          "YYYY-MM-DD",
        )
      : null;
  }
  if (!Object.hasOwn(summaryTypes, type)) throw Error("Неизвестный итог: " + type);
  if (type === "Sum") return numbers.reduce((a, b) => a + b, 0);
  if (type === "Range" && !numbers.length) {
    const dates = present
      .filter((value): value is Date => value instanceof Date)
      .map(Number);
    return dates.length
      ? new BaseDuration(Math.max(...dates) - Math.min(...dates))
      : null;
  }
  if (!numbers.length) return null;
  if (type === "Stddev") {
    const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    return Math.sqrt(
      numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length,
    );
  }
  if (type === "Average") return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  if (type === "Min") return Math.min(...numbers);
  if (type === "Max") return Math.max(...numbers);
  if (type === "Range") return Math.max(...numbers) - Math.min(...numbers);
  const sorted = [...numbers].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function coordinates(
  latitude: unknown,
  longitude: unknown,
): [number, number] | null {
  if (latitude == null || longitude == null || latitude === "" || longitude === "")
    return null;
  const lat = Number(latitude),
    lon = Number(longitude);
  return Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
    ? [lat, lon]
    : null;
}
