import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Hash,
  House,
  ListFilter,
  PanelsTopLeft,
  Paperclip,
  Plus,
  Search,
  Settings,
  Star,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteIndex, SearchResult, VaultInfo } from "../../shared/types";
import { primaryKey } from "../ui";
import { api } from "../useVault";

export type FileFilter = "all" | "note" | "canvas" | "base";
interface SidebarProps {
  vault: VaultInfo;
  index: NoteIndex[];
  active: string | null;
  onOpen: (path: string) => void;
  onAction: (action: string) => void;
  onFileAction: (action: string, path: string) => void;
  section: string;
  setSection: (section: string) => void;
  view: "home" | "graph" | "document" | "collection";
  filter: FileFilter;
  setFilter: (filter: FileFilter) => void;
}
const sections = [
  ["files", Folder, "Файлы"],
  ["search", Search, "Поиск"],
  ["bookmarks", Star, "Закладки"],
  ["tags", Hash, "Теги"],
] as const;
const creationActions = [
  ["new-note", FileText, "Новая заметка"],
  ["new-canvas", PanelsTopLeft, "Новый холст"],
  ["new-base", Table2, "Новая база"],
  ["new-folder", FolderPlus, "Новая папка"],
] as const;
const filters = [
  ["all", "Все"],
  ["note", "Текст"],
  ["canvas", "Холсты"],
  ["base", "Базы"],
] as const;

export default function Sidebar({
  vault,
  index,
  active,
  onOpen,
  onAction,
  onFileAction,
  section,
  setSection,
  view,
  filter,
  setFilter,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [context, setContext] = useState<string | null>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const [filterMenu, setFilterMenu] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const pendingReveal = useRef<string | null>(null);
  const scrollHost = useRef<HTMLDivElement>(null),
    [scrollTop, setScrollTop] = useState(0),
    [viewportHeight, setViewportHeight] = useState(900);
  const tags = useMemo(
    () =>
      [...new Set(index.flatMap((note) => note.tags))].sort((a, b) =>
        a.localeCompare(b, "ru"),
      ),
    [index],
  );
  const visible = useMemo(() => {
    const parents = new Set<string>();
    if (filter !== "all")
      for (const file of vault.files)
        if (file.kind === filter) {
          const parts = file.path.split("/");
          for (let depth = 1; depth < parts.length; depth++)
            parents.add(parts.slice(0, depth).join("/"));
        }
    return vault.files.filter(
      (file) =>
        (filter === "all" || file.kind === filter || parents.has(file.path)) &&
        !hasCollapsedParent(file.path, collapsed),
    );
  }, [vault.files, filter, collapsed]);
  const fileCount = useMemo(
    () =>
      vault.files.filter(
        (file) => file.kind !== "folder" && (filter === "all" || file.kind === filter),
      ).length,
    [vault.files, filter],
  );
  const virtual = visible.length > 200;
  const first = virtual
    ? Math.max(0, Math.min(visible.length - 1, Math.floor(scrollTop / 28) - 12))
    : 0;
  const end = virtual
    ? Math.min(visible.length, first + Math.ceil(viewportHeight / 28) + 24)
    : visible.length;
  useEffect(() => {
    const host = scrollHost.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) =>
      setViewportHeight(entries[0].contentRect.height),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (scrollHost.current) {
      scrollHost.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [section, filter]);
  useEffect(() => {
    if (!active || section !== "files") return;
    pendingReveal.current = active;
    setCollapsed((old) => {
      const next = new Set(old);
      for (const folder of old) if (active.startsWith(folder + "/")) next.delete(folder);
      return next.size === old.size ? old : next;
    });
  }, [active, section]);
  useEffect(() => {
    if (!active || pendingReveal.current !== active || section !== "files") return;
    const position = visible.findIndex((file) => file.path === active),
      host = scrollHost.current;
    if (
      host &&
      position >= 0 &&
      (position * 28 < host.scrollTop ||
        (position + 1) * 28 > host.scrollTop + host.clientHeight)
    )
      host.scrollTop = Math.max(0, position * 28 - host.clientHeight / 2);
    if (position >= 0) pendingReveal.current = null;
  }, [active, section, visible]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          ".file-context, .tree-more, .create-menu, .create-menu-toggle, .file-filter-menu, .filter-menu-toggle",
        )
      ) {
        setContext(null);
        setCreateMenu(false);
        setFilterMenu(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContext(null);
        setCreateMenu(false);
        setFilterMenu(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    if (section === "search") searchInput.current?.focus();
  }, [section]);
  useEffect(() => {
    let alive = true;
    if (section !== "search" || !query.trim()) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(
      () =>
        api()
          .search(query)
          .then((value) => {
            if (alive) setResults(value);
          })
          .catch((error) => {
            if (alive) {
              setResults([]);
              setSearchError(String(error.message || "Не удалось выполнить поиск"));
            }
          })
          .finally(() => {
            if (alive) setSearching(false);
          }),
      140,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, section, vault.root]);

  return (
    <aside className="sidebar" aria-label="Навигация по хранилищу">
      <div className="sidebar-top">
        <button
          className="vault-switch"
          onClick={() => onAction("vault-menu")}
          title="Сменить хранилище"
          aria-label={"Хранилище: " + vault.name}
        >
          <strong>{vault.name}</strong>
          <ChevronDown size={16} />
        </button>
        <div className="sidebar-create">
          <button
            className="create-menu-toggle icon-button"
            aria-label="Создать файл"
            title="Создать файл"
            aria-expanded={createMenu}
            onClick={() => setCreateMenu(!createMenu)}
          >
            <Plus size={16} />
          </button>
          {createMenu && (
            <div className="create-menu" role="menu" aria-label="Создать файл">
              {creationActions.map(([action, Icon, label]) => (
                <button
                  role="menuitem"
                  key={action}
                  onClick={() => {
                    setCreateMenu(false);
                    onAction(action);
                  }}
                >
                  <Icon size={16} />
                  {label}
                  {action === "new-note" && <kbd>{primaryKey}N</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <nav className="workspace-nav" aria-label="Разделы хранилища">
        <button
          className={view === "home" ? "active" : ""}
          aria-current={view === "home" ? "page" : undefined}
          onClick={() => onAction("home")}
        >
          <House size={17} />
          <span>Главная</span>
        </button>
        <button
          className={view === "graph" ? "active" : ""}
          aria-label="Граф знаний"
          aria-current={view === "graph" ? "page" : undefined}
          onClick={() => onAction("graph")}
        >
          <GitBranch size={17} />
          <span>Граф знаний</span>
        </button>
        <button title="Ежедневная заметка" onClick={() => onAction("daily")}>
          <CalendarDays size={17} />
          <span>Сегодня</span>
        </button>
      </nav>
      <div className="sidebar-tabs" role="group" aria-label="Инструменты хранилища">
        {sections.map(([id, Icon, label]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            title={label}
            aria-label={label}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      <div className="sidebar-section-title">
        <span>
          {
            (
              {
                files: filters.find(([kind]) => kind === filter)?.[1] || "Файлы",
                search: "Поиск по содержимому",
                bookmarks: "Закладки",
                tags: "Теги",
              } as Record<string, string>
            )[section]
          }
        </span>
        {section === "files" && (
          <div className="file-filter-control">
            <span className="count">{fileCount}</span>
            <button
              className={
                "filter-menu-toggle icon-button " + (filter !== "all" ? "active" : "")
              }
              title="Фильтр файлов"
              aria-label="Фильтр файлов"
              aria-expanded={filterMenu}
              onClick={() => setFilterMenu(!filterMenu)}
            >
              <ListFilter size={16} />
            </button>
            {filterMenu && (
              <div className="file-filter-menu" role="menu" aria-label="Тип файлов">
                {filters.map(([kind, label]) => (
                  <button
                    key={kind}
                    role="menuitemradio"
                    aria-checked={filter === kind}
                    onClick={() => {
                      setFilter(kind);
                      setFilterMenu(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div
        className="sidebar-scroll"
        ref={scrollHost}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setContext(null);
        }}
      >
        {section === "files" && (
          <>
            <div
              className={"file-tree" + (virtual ? " virtual-tree" : "")}
              style={
                virtual
                  ? { paddingTop: first * 28, paddingBottom: (visible.length - end) * 28 }
                  : undefined
              }
            >
              {visible.slice(first, end).map((file) => {
                const Icon =
                  file.kind === "folder"
                    ? Folder
                    : file.kind === "canvas"
                      ? PanelsTopLeft
                      : file.kind === "base"
                        ? Table2
                        : file.kind === "attachment"
                          ? Paperclip
                          : FileText;
                return (
                  <div
                    className={
                      "tree-row kind-" +
                      file.kind +
                      (active === file.path && view === "document" ? " active" : "")
                    }
                    style={{ paddingLeft: 7 + (file.path.split("/").length - 1) * 14 }}
                    key={file.path}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContext(file.path);
                    }}
                  >
                    <button
                      className="tree-file"
                      title={file.path}
                      aria-current={
                        active === file.path && view === "document" ? "page" : undefined
                      }
                      aria-expanded={
                        file.kind === "folder" ? !collapsed.has(file.path) : undefined
                      }
                      onClick={() => {
                        setContext(null);
                        if (file.kind === "folder")
                          setCollapsed((old) => {
                            const next = new Set(old);
                            next.has(file.path)
                              ? next.delete(file.path)
                              : next.add(file.path);
                            return next;
                          });
                        else onOpen(file.path);
                      }}
                    >
                      {file.kind === "folder" ? (
                        collapsed.has(file.path) ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )
                      ) : (
                        <span className="tree-spacer" />
                      )}
                      <Icon size={15} />
                      <span>{file.name.replace(/\.(md|canvas|base)$/i, "")}</span>
                    </button>
                    <button
                      className="tree-more"
                      title="Действия с файлом"
                      aria-label={"Действия: " + file.name}
                      aria-expanded={context === file.path}
                      onClick={() => setContext(context === file.path ? null : file.path)}
                    >
                      <Ellipsis size={16} />
                    </button>
                    {context === file.path && (
                      <div className="file-context" role="menu">
                        {[
                          ["rename", "Переименовать / переместить"],
                          ["reveal", "Показать в Finder / Проводнике"],
                          ["trash", "В корзину"],
                        ].map(([action, label]) => (
                          <button
                            key={action}
                            className={action === "trash" ? "danger-text" : ""}
                            onClick={() => {
                              setContext(null);
                              onFileAction(action, file.path);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!visible.length && (
              <div className="sidebar-empty">
                <Folder size={24} />
                <strong>
                  {filter === "canvas"
                    ? "Пока нет холстов"
                    : filter === "base"
                      ? "Пока нет баз"
                      : "Здесь будут ваши заметки"}
                </strong>
                <p>
                  {filter === "canvas"
                    ? "Создайте холст через меню «+»."
                    : filter === "base"
                      ? "Объедините заметки в таблицу или доску."
                      : "Создайте заметку через меню «+»."}
                </p>
                <button
                  className="text-link"
                  onClick={() =>
                    onAction(
                      filter === "canvas"
                        ? "new-canvas"
                        : filter === "base"
                          ? "new-base"
                          : "new-note",
                    )
                  }
                >
                  <Plus size={14} />
                  Создать{" "}
                  {filter === "canvas" ? "холст" : filter === "base" ? "базу" : "заметку"}
                </button>
              </div>
            )}
          </>
        )}
        {section === "search" && (
          <div className="search-panel">
            <div className="search-field">
              <Search size={15} />
              <input
                ref={searchInput}
                value={query}
                aria-label="Поиск по содержимому"
                placeholder="Текст, tag:тег, path:папка"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button aria-label="Очистить поиск" onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            {query.trim() && (
              <small className="search-summary" aria-live="polite">
                {searching
                  ? "Ищем в заметках…"
                  : searchError || `Совпадений: ${results.length}`}
              </small>
            )}
            {!query.trim() ? (
              <div className="search-guide">
                <strong>Поиск по заметкам</strong>
                <p>Ищем по тексту и названиям заметок.</p>
                <button onClick={() => setQuery("tag:")}>
                  <code>tag:</code>
                  <span>Найти по тегу</span>
                </button>
                <button onClick={() => setQuery("path:")}>
                  <code>path:</code>
                  <span>В определённой папке</span>
                </button>
                <small>
                  Фраза: «&quot;точный текст&quot;». Группы: (слово OR другое) -tag:архив.
                  Свойства: [status: active], [rating:&gt;=3]. Регулярные выражения:
                  /текст/i.
                </small>
              </div>
            ) : !searching && !results.length && !searchError ? (
              <div className="sidebar-empty">
                <Search size={23} />
                <strong>Ничего не найдено</strong>
                <p>Попробуйте более короткое слово или другой запрос.</p>
              </div>
            ) : null}
            {results.map((result, i) => (
              <button
                className="search-result"
                key={result.path + i}
                onClick={() => onOpen(result.path)}
              >
                <strong>{result.path.replace(/\.md$/i, "")}</strong>
                <span>{result.text}</span>
                <small>Строка {result.line}</small>
              </button>
            ))}
          </div>
        )}
        {section === "bookmarks" &&
          (vault.preferences.bookmarks.length ? (
            vault.preferences.bookmarks.map((path) => (
              <button className="simple-row" key={path} onClick={() => onOpen(path)}>
                <Star size={14} />
                {path.replace(/\.md$/i, "")}
              </button>
            ))
          ) : (
            <div className="sidebar-empty">
              <Star size={24} />
              <strong>Нет закладок</strong>
              <p>Откройте заметку и нажмите звезду вверху. Она появится здесь.</p>
            </div>
          ))}
        {section === "tags" &&
          (tags.length ? (
            tags.map((tag) => (
              <button
                className="simple-row"
                key={tag}
                onClick={() => {
                  setSection("search");
                  setQuery("tag:" + tag);
                }}
              >
                <Hash size={14} />
                {tag}
                <span className="count">
                  {index.filter((note) => note.tags.includes(tag)).length}
                </span>
              </button>
            ))
          ) : (
            <div className="sidebar-empty">
              <Hash size={24} />
              <strong>Нет тегов</strong>
              <p>Добавьте #тег в текст или свойство tags.</p>
            </div>
          ))}
      </div>
      <div className="sidebar-bottom">
        <button onClick={() => onAction("settings")} aria-label="Настройки">
          <Settings size={16} />
          <span>Настройки</span>
        </button>
      </div>
    </aside>
  );
}

function hasCollapsedParent(path: string, collapsed: Set<string>) {
  let separator = path.lastIndexOf("/");
  while (separator >= 0) {
    const parent = path.slice(0, separator);
    if (collapsed.has(parent)) return true;
    separator = parent.lastIndexOf("/");
  }
  return false;
}
