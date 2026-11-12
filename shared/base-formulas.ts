import { basePropertyExpression } from "./base-document";
import { parseFormula } from "./base-syntax";
function references(source: string, name: string): boolean {
  const { syntax } = parseFormula(source);
  const visit = (node: any): boolean => {
    if (!node || typeof node !== "object") return false;
    if (
      node.type === "MemberExpression" &&
      node.object.type === "Identifier" &&
      node.object.name === "formula" &&
      (node.computed ? node.property.value : node.property.name) === name
    )
      return true;
    return Object.values(node).some((value) =>
      Array.isArray(value) ? value.some(visit) : visit(value),
    );
  };
  return visit(syntax);
}
export function renameFormulaReferences(
  source: string,
  from: string,
  to: string,
): string {
  if (!references(source, from)) return source;
  const { syntax, regexes } = parseFormula(source);
  const print = (node: any): string => {
    if (node.type === "Literal") return JSON.stringify(node.value);
    if (node.type === "Identifier")
      return regexes.get(node.name)?.toString() || node.name;
    if (node.type === "ThisExpression") return "this";
    if (node.type === "ArrayExpression")
      return "[" + node.elements.map(print).join(", ") + "]";
    if (node.type === "UnaryExpression")
      return "(" + node.operator + print(node.argument) + ")";
    if (node.type === "BinaryExpression" || node.type === "LogicalExpression")
      return "(" + print(node.left) + " " + node.operator + " " + print(node.right) + ")";
    if (node.type === "ConditionalExpression")
      return (
        "(" +
        print(node.test) +
        " ? " +
        print(node.consequent) +
        " : " +
        print(node.alternate) +
        ")"
      );
    if (node.type === "CallExpression")
      return print(node.callee) + "(" + node.arguments.map(print).join(", ") + ")";
    if (node.type === "MemberExpression") {
      if (
        node.object.type === "Identifier" &&
        node.object.name === "formula" &&
        (node.computed ? node.property.value : node.property.name) === from
      )
        return basePropertyExpression("formula." + to);
      return (
        print(node.object) +
        (node.computed ? "[" + print(node.property) + "]" : "." + node.property.name)
      );
    }
    throw Error("Не удалось безопасно переименовать ссылку в формуле");
  };
  return print(syntax);
}
function mapFilters(value: any, transform: (value: string) => string): any {
  if (typeof value === "string") return transform(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const key = ["and", "or", "not"].find((key) => Array.isArray(value[key]));
  return key
    ? { ...value, [key]: value[key].map((value: any) => mapFilters(value, transform)) }
    : value;
}
export function renameBaseFormula(
  document: Record<string, any>,
  from: string,
  to: string,
): Record<string, any> {
  if (
    !to.trim() ||
    to.length > 150 ||
    ["__proto__", "constructor", "prototype"].includes(to)
  )
    throw Error("Некорректное имя формулы");
  if (from === to) return document;
  if (Object.hasOwn(document.formulas || {}, to))
    throw Error("Формула с таким именем уже существует");
  const before = "formula." + from,
    after = "formula." + to,
    property = (value: string) => (value === before ? after : value);
  const transform = (source: string) => renameFormulaReferences(source, from, to);
  return {
    ...document,
    formulas: Object.fromEntries(
      Object.entries(document.formulas || {}).map(([key, value]) => [
        key === from ? to : key,
        transform(String(value)),
      ]),
    ),
    properties: Object.fromEntries(
      Object.entries(document.properties || {}).map(([key, value]) => [
        property(key),
        value,
      ]),
    ),
    filters: mapFilters(document.filters, transform),
    views: (document.views || []).map((view: any) => ({
      ...view,
      filters: mapFilters(view.filters, transform),
      ...(view.order ? { order: view.order.map(property) } : {}),
      ...(view.sort
        ? {
            sort: view.sort.map((sort: any) => ({
              ...sort,
              property: property(sort.property),
            })),
          }
        : {}),
      ...(view.groupBy
        ? { groupBy: { ...view.groupBy, property: property(view.groupBy.property) } }
        : {}),
      ...(view.image ? { image: property(view.image) } : {}),
      ...(view.columnSize
        ? {
            columnSize: Object.fromEntries(
              Object.entries(view.columnSize).map(([key, value]) => [
                property(key),
                value,
              ]),
            ),
          }
        : {}),
      ...(view.latitude ? { latitude: property(view.latitude) } : {}),
      ...(view.longitude ? { longitude: property(view.longitude) } : {}),
      ...(view.summaries
        ? {
            summaries: Object.fromEntries(
              Object.entries(view.summaries).map(([key, value]) => [
                property(key),
                value,
              ]),
            ),
          }
        : {}),
    })),
  };
}
export function removeBaseFormula(
  document: Record<string, any>,
  name: string,
): Record<string, any> {
  const dependents: string[] = [];
  for (const [key, source] of Object.entries(document.formulas || {}))
    if (key !== name && references(String(source), name)) dependents.push(key);
  const checkFilter = (filter: unknown) =>
    mapFilters(filter, (value) => {
      if (references(value, name)) dependents.push("фильтр");
      return value;
    });
  checkFilter(document.filters);
  for (const view of document.views || []) checkFilter(view.filters);
  if (dependents.length)
    throw Error(
      "Сначала измените ссылки на эту формулу: " + [...new Set(dependents)].join(", "),
    );
  const formulas = { ...document.formulas };
  delete formulas[name];
  const property = "formula." + name;
  const properties = { ...document.properties };
  delete properties[property];
  return {
    ...document,
    formulas,
    properties,
    views: (document.views || []).map((view: any) => {
      const summaries = { ...view.summaries };
      delete summaries[property];
      return {
        ...view,
        ...(view.order
          ? { order: view.order.filter((value: string) => value !== property) }
          : {}),
        ...(view.sort
          ? { sort: view.sort.filter((value: any) => value.property !== property) }
          : {}),
        ...(view.groupBy?.property === property
          ? { groupBy: undefined, groupOrder: undefined }
          : {}),
        ...(view.image === property ? { image: undefined } : {}),
        ...(view.summaries ? { summaries } : {}),
      };
    }),
  };
}
