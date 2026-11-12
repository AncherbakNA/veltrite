import { isMap, isSeq, parseDocument } from "yaml";
import { parseFormula } from "./base-syntax";
export const baseViewNames: Record<string, string> = {
  table: "Таблица",
  cards: "Карточки",
  list: "Список",
  kanban: "Канбан",
  map: "Карта",
};
export function basePropertyExpression(property: string): string {
  const dot = property.indexOf("."),
    prefix =
      dot >= 0 && ["file", "formula", "note"].includes(property.slice(0, dot))
        ? property.slice(0, dot)
        : "note";
  const name =
    prefix === "note" && !property.startsWith("note.")
      ? property
      : property.slice(dot + 1);
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)
    ? prefix + "." + name
    : prefix + "[" + JSON.stringify(name) + "]";
}
export function conditionExpression(
  property: string,
  operator: string,
  value: string,
  type?: string,
): string {
  const expression = basePropertyExpression(property);
  if (operator === "empty") return expression + ".isEmpty()";
  if (operator === "filled") return "!" + expression + ".isEmpty()";
  let literal = JSON.stringify(value);
  if (type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || !value.trim()) throw Error("Введите число");
    literal = String(number);
  } else if (type === "checkbox") {
    if (!["true", "false"].includes(value))
      throw Error("Для флажка введите true или false");
    literal = value;
  } else if (["date", "datetime"].includes(type || ""))
    literal = "date(" + JSON.stringify(value) + ")";
  if (operator === "contains") return expression + ".contains(" + literal + ")";
  if (operator === "tag")
    return "file.hasTag(" + JSON.stringify(value.replace(/^#/, "")) + ")";
  if (operator === "folder") return "file.inFolder(" + JSON.stringify(value) + ")";
  if (!["==", "!=", ">", ">=", "<", "<="].includes(operator))
    throw Error("Неизвестное условие");
  return expression + " " + operator + " " + literal;
}
export function validateBaseFilters(filter: unknown, depth = 0): void {
  if (depth > 32) throw Error("Слишком глубокие фильтры");
  if (filter == null) return;
  if (typeof filter === "string") {
    parseFormula(filter);
    return;
  }
  if (!filter || typeof filter !== "object" || Array.isArray(filter))
    throw Error("Некорректный фильтр");
  const key = ["and", "or", "not"].find((key) => Object.hasOwn(filter, key));
  if (!key || !Array.isArray((filter as any)[key]))
    throw Error("Некорректная группа фильтров");
  for (const child of (filter as any)[key]) validateBaseFilters(child, depth + 1);
}
/** Modify only changed YAML nodes, preserving comments, order and unknown view fields. */
export function writeBaseDocument(content: string, next: Record<string, any>): string {
  const doc = parseDocument(content);
  if (doc.errors.length || !isMap(doc.contents))
    throw Error("Исправьте YAML базы перед настройкой");
  const previous = doc.toJS({ maxAliasCount: 20 });
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function update(path: (string | number)[], before: any, after: any) {
    if (equal(before, after)) return;
    const node = doc.getIn(path, true);
    if (Array.isArray(before) && Array.isArray(after) && isSeq(node)) {
      for (let i = before.length - 1; i >= after.length; i--) doc.deleteIn([...path, i]);
      for (let i = 0; i < after.length; i++)
        if (i < before.length) update([...path, i], before[i], after[i]);
        else doc.setIn([...path, i], after[i]);
    } else if (
      before &&
      after &&
      typeof before === "object" &&
      typeof after === "object" &&
      !Array.isArray(before) &&
      !Array.isArray(after) &&
      isMap(node)
    ) {
      for (const key of Object.keys(before))
        if (!Object.hasOwn(after, key) || after[key] === undefined)
          doc.deleteIn([...path, key]);
      for (const [key, value] of Object.entries(after))
        if (value !== undefined) update([...path, key], before[key], value);
    } else if (after === undefined) doc.deleteIn(path);
    else doc.setIn(path, after);
  }
  update([], previous, next);
  return doc.toString();
}
