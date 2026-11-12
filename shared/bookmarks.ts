export type Bookmark = { id: string; title: string } & (
  | { type: "file"; path: string; fragment?: string }
  | { type: "folder"; path: string }
  | { type: "search"; query: string }
  | { type: "url"; url: string }
  | { type: "graph"; query: string; local?: string }
  | { type: "group"; children: Bookmark[] }
);

function path(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\\]/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    /^[a-z]:/i.test(value) ||
    value.startsWith(".veltrite/")
  )
    throw Error("Некорректный путь закладки");
  return value;
}
/** One bounded, serializable tree, shared by the sidebar, settings migration and rename. */
export function normalizeBookmarks(input: unknown): Bookmark[] {
  const ids = new Set<string>();
  let count = 0;
  function visit(items: unknown, depth: number): Bookmark[] {
    if (!Array.isArray(items) || depth > 8) throw Error("Некорректные группы закладок");
    return items.map((raw) => {
      if (!raw || typeof raw !== "object" || ++count > 50000)
        throw Error("Слишком много закладок");
      const item = raw as Record<string, unknown>;
      if (
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 120 ||
        ids.has(item.id) ||
        typeof item.title !== "string" ||
        item.title.length > 500
      )
        throw Error("Некорректная закладка");
      ids.add(item.id);
      const base = { id: item.id, title: item.title };
      if (item.type === "group")
        return { ...base, type: "group", children: visit(item.children, depth + 1) };
      if (item.type === "file") {
        if (
          item.fragment !== undefined &&
          (typeof item.fragment !== "string" || item.fragment.length > 1000)
        )
          throw Error("Некорректный фрагмент");
        return {
          ...base,
          type: "file",
          path: path(item.path),
          ...(item.fragment ? { fragment: item.fragment as string } : {}),
        };
      }
      if (item.type === "folder")
        return { ...base, type: "folder", path: path(item.path) };
      if (item.type === "search" || item.type === "graph") {
        if (typeof item.query !== "string" || item.query.length > 4000)
          throw Error("Некорректный поиск закладки");
        return item.type === "search"
          ? { ...base, type: "search", query: item.query }
          : {
              ...base,
              type: "graph",
              query: item.query,
              ...(item.local ? { local: path(item.local) } : {}),
            };
      }
      if (
        item.type === "url" &&
        typeof item.url === "string" &&
        item.url.length <= 8000 &&
        /^https?:\/\//i.test(item.url)
      ) {
        const url = new URL(item.url);
        if (url.username || url.password)
          throw Error("В адресе закладки не должно быть пароля");
        return { ...base, type: "url", url: url.href };
      }
      throw Error("Неизвестный тип закладки");
    });
  }
  return visit(input, 0);
}
export function allBookmarks(items: Bookmark[]): Bookmark[] {
  return items.flatMap((item) =>
    item.type === "group" ? [item, ...allBookmarks(item.children)] : [item],
  );
}

export function importBookmarks(
  input: unknown,
  paths: Set<string>,
): { items: Bookmark[]; skipped: number } {
  let counter = 0,
    skipped = 0;
  const visit = (values: unknown, depth: number): Bookmark[] => {
    if (!Array.isArray(values) || depth > 7) return [];
    return values.slice(0, 5000).flatMap((value) => {
      try {
        if (!value || typeof value !== "object") throw Error();
        const item = value as Record<string, any>,
          base = {
            id: "imported-" + ++counter,
            title: typeof item.title === "string" ? item.title.slice(0, 500) : "",
          };
        let bookmark: Bookmark;
        if (item.type === "group")
          bookmark = {
            ...base,
            type: "group",
            children: visit(item.items || item.children, depth + 1),
          };
        else if (item.type === "file" && paths.has(item.path))
          bookmark = {
            ...base,
            type: "file",
            path: item.path,
            ...(typeof item.subpath === "string" && item.subpath
              ? { fragment: item.subpath.replace(/^#/, "") }
              : {}),
          };
        else if (item.type === "folder" && paths.has(item.path))
          bookmark = { ...base, type: "folder", path: item.path };
        else if (item.type === "search")
          bookmark = { ...base, type: "search", query: item.query };
        else if (item.type === "url") bookmark = { ...base, type: "url", url: item.url };
        else throw Error();
        return normalizeBookmarks([bookmark]);
      } catch {
        skipped++;
        return [];
      }
    });
  };
  const items = visit(input, 0);
  return { items, skipped };
}
export function legacyBookmarks(items: Bookmark[]): string[] {
  return [
    ...new Set(
      allBookmarks(items)
        .filter((item) => item.type === "file" && !item.fragment)
        .map((item) => (item as Bookmark & { path: string }).path),
    ),
  ];
}
export function fromLegacyBookmarks(paths: string[]): Bookmark[] {
  return [...new Set(paths)].map((path, i) => ({
    id: "file-" + i,
    type: "file",
    title: "",
    path,
  }));
}
export function mapBookmarks(
  items: Bookmark[],
  map: (item: Bookmark) => Bookmark | null,
): Bookmark[] {
  return items.flatMap((item) => {
    const next = map(
      item.type === "group"
        ? { ...item, children: mapBookmarks(item.children, map) }
        : item,
    );
    return next ? [next] : [];
  });
}
export function moveBookmark(
  items: Bookmark[],
  id: string,
  parent: string | null,
  before?: string,
): Bookmark[] {
  const item = allBookmarks(items).find((value) => value.id === id);
  if (
    !item ||
    id === parent ||
    (item.type === "group" &&
      allBookmarks(item.children).some((value) => value.id === parent))
  )
    return items;
  const root = mapBookmarks(items, (value) => (value.id === id ? null : value));
  const insert = (values: Bookmark[]) => {
    const index = values.findIndex((value) => value.id === before);
    return [
      ...values.slice(0, index < 0 ? values.length : index),
      item,
      ...values.slice(index < 0 ? values.length : index),
    ];
  };
  if (!parent) return insert(root);
  if (!allBookmarks(root).some((value) => value.id === parent && value.type === "group"))
    return items;
  return mapBookmarks(root, (value) =>
    value.id === parent && value.type === "group"
      ? { ...value, children: insert(value.children) }
      : value,
  );
}
