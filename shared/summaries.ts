import { evaluateExpression } from "./bases";
export const summaryTypes: Record<string, string> = {
  CountAll: "Количество",
  CountValues: "Заполнено",
  Empty: "Пусто",
  Unique: "Уникальных",
  Sum: "Сумма",
  Average: "Среднее",
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
  const present = values.filter((v) => v != null && v !== ""),
    numbers = present.filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
  if (Object.hasOwn(custom, type)) return evaluateExpression(custom[type], { values });
  if (type === "CountAll") return values.length;
  if (type === "CountValues") return present.length;
  if (type === "Empty") return values.length - present.length;
  if (type === "Unique") return new Set(present.map((v) => JSON.stringify(v))).size;
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
      .map((v) => (v instanceof Date ? +v : typeof v === "string" ? Date.parse(v) : NaN))
      .filter(Number.isFinite);
    return dates.length
      ? new Date((type === "Earliest" ? Math.min : Math.max)(...dates))
          .toISOString()
          .slice(0, 10)
      : null;
  }
  if (!Object.hasOwn(summaryTypes, type)) throw Error("Неизвестный итог: " + type);
  if (type === "Sum") return numbers.reduce((a, b) => a + b, 0);
  if (!numbers.length) return null;
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
