export type PropertyType =
  "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "tags" | "url";
export const propertyTypes: Record<PropertyType, string> = {
  text: "Текст",
  number: "Число",
  checkbox: "Флажок",
  date: "Дата",
  datetime: "Дата и время",
  list: "Список",
  tags: "Теги",
  url: "Ссылка",
};
export function propertyType(value: unknown): PropertyType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value)) return "list";
  return "text";
}
export function parseProperty(input: unknown, type: PropertyType): unknown {
  if (input === "" || input == null)
    return type === "checkbox" ? false : type === "list" || type === "tags" ? [] : null;
  if (type === "number") {
    const number =
      typeof input === "number"
        ? input
        : typeof input === "string" && input.trim()
          ? Number(input)
          : NaN;
    if (!Number.isFinite(number)) throw Error("Введите конечное число");
    return number;
  }
  if (type === "checkbox") {
    if (input === true || input === "true") return true;
    if (input === false || input === "false") return false;
    throw Error("Флажок принимает true или false");
  }
  if (type === "date") {
    const text = String(input),
      date = new Date(text + "T12:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(+date) ||
      date.toISOString().slice(0, 10) !== text
    )
      throw Error("Введите дату ГГГГ-ММ-ДД");
    return text;
  }
  if (type === "datetime") {
    const text = String(input),
      date = new Date(text);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) || !Number.isFinite(+date))
      throw Error("Введите дату и время");
    return date.toISOString();
  }
  if (type === "list" || type === "tags") {
    const values = Array.isArray(input)
      ? input
      : String(input)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    if (values.length > 1000 || values.some((v) => typeof v === "object"))
      throw Error("Список должен содержать до 1000 простых значений");
    return type === "tags"
      ? [...new Set(values.map((v) => String(v).replace(/^#/, "")))]
      : values;
  }
  const text = String(input);
  if (type === "url" && !/^https?:\/\//i.test(text))
    throw Error("Ссылка должна начинаться с https:// или http://");
  return text;
}
