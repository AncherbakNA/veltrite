import { parseSearch } from "./search";
export interface GraphOptions {
  depth: number;
  direction: "both" | "incoming" | "outgoing";
  orphans: boolean;
  tags: boolean;
  attachments: boolean;
  unresolved: boolean;
  arrows: boolean;
  labels: boolean;
  nodeScale: number;
  linkScale: number;
  charge: number;
  distance: number;
  groups: { query: string; color: string }[];
}
export const defaultGraphOptions: GraphOptions = {
  depth: 1,
  direction: "both",
  orphans: true,
  tags: false,
  attachments: false,
  unresolved: false,
  arrows: false,
  labels: true,
  nodeScale: 1,
  linkScale: 1,
  charge: 80,
  distance: 65,
  groups: [],
};
export function validateGraphOptions(value: unknown): GraphOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Некорректные настройки графа");
  const input = value as GraphOptions,
    next = Object.fromEntries(
      Object.keys(defaultGraphOptions).map((key) => [
        key,
        input[key as keyof GraphOptions] ??
          defaultGraphOptions[key as keyof GraphOptions],
      ]),
    ) as unknown as GraphOptions;
  for (const key of [
    "orphans",
    "tags",
    "attachments",
    "unresolved",
    "arrows",
    "labels",
  ] as const)
    if (typeof next[key] !== "boolean") throw Error("Некорректные настройки графа");
  if (
    !Number.isInteger(next.depth) ||
    next.depth < 1 ||
    next.depth > 10 ||
    !["both", "incoming", "outgoing"].includes(next.direction)
  )
    throw Error("Некорректная глубина графа");
  for (const [key, min, max] of [
    ["nodeScale", 0.25, 4],
    ["linkScale", 0.25, 4],
    ["charge", 0, 1000],
    ["distance", 10, 500],
  ] as const)
    if (!Number.isFinite(next[key]) || next[key] < min || next[key] > max)
      throw Error("Некорректный размер графа");
  if (!Array.isArray(next.groups) || next.groups.length > 30)
    throw Error("Можно создать до 30 групп графа");
  next.groups = next.groups.map((group) => {
    if (
      !group ||
      typeof group.query !== "string" ||
      group.query.length > 500 ||
      !/^#[a-f0-9]{6}$/i.test(group.color)
    )
      throw Error("Некорректная группа графа");
    parseSearch(group.query);
    return { query: group.query, color: group.color };
  });
  return next;
}
