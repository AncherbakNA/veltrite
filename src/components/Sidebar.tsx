import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Command,
  Ellipsis,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Hash,
  House,
  Import,
  Mic,
  PanelsTopLeft,
  Paperclip,
  Plus,
  Search,
  Settings,
  Square,
  Star,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  recording: boolean;
}
const sections = [
  ["files", Folder, "Файлы"],
  ["search", Search, "Поиск"],
  ["bookmarks", Star, "Закладки"],
  ["tags", Hash, "Теги"],
] as const;
const creationActions = [
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
  recording,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [context, setContext] = useState<string | null>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const tags = [...new Set(index.flatMap((note) => note.tags))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
  const parentFolders = new Set<string>();
  if (filter !== "all")
    for (const file of vault.files.filter((file) => file.kind === filter)) {
      const parts = file.path.split("/");
      for (let depth = 1; depth < parts.length; depth++)
        parentFolders.add(parts.slice(0, depth).join("/"));
    }
  const visible = vault.files.filter(
    (file) =>
      (filter === "all" || file.kind === filter || parentFolders.has(file.path)) &&
      ![...collapsed].some((folder) => file.path.startsWith(folder + "/")),
  );
  const fileCount = vault.files.filter(
    (file) => file.kind !== "folder" && (filter === "all" || file.kind === filter),
  ).length;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          ".file-context, .tree-more, .create-menu, .create-menu-toggle",
        )
      ) {
        setContext(null);
        setCreateMenu(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContext(null);
        setCreateMenu(false);
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
      <button
        className="vault-switch"
        onClick={() => onAction("vault-menu")}
        title="Сменить хранилище"
      >
        <span className="vault-avatar">{vault.name.slice(0, 1).toUpperCase()}</span>
        <span>
          <small>РАБОЧЕЕ ПРОСТРАНСТВО</small>
          <strong>{vault.name}</strong>
        </span>
        <ChevronDown size={15} />
      </button>
      <div className="sidebar-create">
        <button
          className="primary"
          aria-label="Новая заметка"
          onClick={() => onAction("new-note")}
        >
          <Plus size={17} />
          <span>Заметка</span>
          <kbd>{primaryKey} N</kbd>
        </button>
        <button
          className="new-canvas-shortcut"
          title="Новый холст"
          aria-label="Новый холст"
          onClick={() => onAction("new-canvas")}
        >
          <PanelsTopLeft size={16} />
          <span>Холст</span>
        </button>
        <button
          className="create-menu-toggle"
          aria-label="Другие способы создания"
          aria-expanded={createMenu}
          onClick={() => setCreateMenu(!createMenu)}
        >
          <ChevronDown size={14} />
        </button>
        {createMenu && (
          <div className="create-menu" role="menu">
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
              </button>
            ))}
          </div>
        )}
      </div>
      <nav className="workspace-nav" aria-label="Разделы пространства">
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
          <span className="nav-detail">связи</span>
        </button>
        <button title="Ежедневная заметка" onClick={() => onAction("daily")}>
          <CalendarDays size={17} />
          <span>Сегодня</span>
          <span className="nav-detail">дневник</span>
        </button>
      </nav>
      <div className="sidebar-library-label">
        ХРАНИЛИЩЕ<span>{fileCount}</span>
      </div>
      <div className="sidebar-tabs" role="group" aria-label="Инструменты хранилища">
        {sections.map(([id, Icon, label]) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            title={label}
            aria-pressed={section === id}
            onClick={() => setSection(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-section-title">
        <span>
          {
            (
              {
                files: "Все файлы",
                search: "Поиск по содержимому",
                bookmarks: "Ваши закладки",
                tags: "Все теги",
              } as Record<string, string>
            )[section]
          }
        </span>
        {section === "files" && (
          <button
            title="Новая папка"
            aria-label="Новая папка"
            onClick={() => onAction("new-folder")}
          >
            <FolderPlus size={15} />
          </button>
        )}
      </div>
      {section === "files" && (
        <div className="file-filters" role="group" aria-label="Тип файлов">
          {filters.map(([kind, label]) => (
            <button
              key={kind}
              aria-pressed={filter === kind}
              className={filter === kind ? "active" : ""}
              onClick={() => setFilter(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="sidebar-scroll">
        {section === "files" && (
          <>
            <div className="file-tree">
              {visible.map((file) => {
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
                    ? "Соберите идеи на одном холсте."
                    : filter === "base"
                      ? "Объедините заметки в таблицу или доску."
                      : "Начните с одной мысли — остальное придёт."}
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
                <strong>Найдите нужную мысль</strong>
                <p>Ищем по тексту и названиям заметок.</p>
                <button onClick={() => setQuery("tag:")}>
                  <code>tag:</code>
                  <span>Найти по тегу</span>
                </button>
                <button onClick={() => setQuery("path:")}>
                  <code>path:</code>
                  <span>В определённой папке</span>
                </button>
                <small>Точную фразу заключите в кавычки.</small>
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
              <strong>Самое важное — под рукой</strong>
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
              <strong>У каждой идеи есть тема</strong>
              <p>Добавьте в заметку #тег — так проще находить связанные мысли.</p>
            </div>
          ))}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-import" onClick={() => onAction("import")}>
          <Import size={15} />
          <span>Импорт из Obsidian</span>
        </button>
        <div className="sidebar-utilities">
          <button onClick={() => onAction("settings")} aria-label="Настройки">
            <Settings size={16} />
            <span>Настройки</span>
          </button>
          <button
            title="Все команды"
            aria-label="Все команды"
            onClick={() => onAction("commands")}
          >
            <Command size={16} />
          </button>
          <button
            title={recording ? "Остановить запись" : "Записать аудио"}
            aria-label={recording ? "Остановить запись" : "Записать аудио"}
            className={recording ? "recording" : ""}
            onClick={() => onAction("record")}
          >
            {recording ? <Square size={15} /> : <Mic size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
