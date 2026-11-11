import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  FileText,
  Folder,
  FolderPlus,
  Hash,
  Import,
  PanelsTopLeft,
  Paperclip,
  Plus,
  Search,
  Star,
  Table2,
} from "lucide-react";
import { useState } from "react";
import type { NoteIndex, SearchResult, VaultInfo } from "../../shared/types";
import { api } from "../useVault";
export default function Sidebar({
  vault,
  index,
  active,
  onOpen,
  onAction,
  onFileAction,
  section,
  setSection,
}: {
  vault: VaultInfo;
  index: NoteIndex[];
  active: string | null;
  onOpen: (p: string) => void;
  onAction: (a: string) => void;
  onFileAction: (a: string, p: string) => void;
  section: string;
  setSection: (s: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<SearchResult[]>([]),
    [context, setContext] = useState<string | null>(null);
  const tags = [...new Set(index.flatMap((n) => n.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
  const visible = vault.files.filter(
    (f) => ![...collapsed].some((dir) => f.path.startsWith(dir + "/")),
  );
  return (
    <aside className="sidebar">
      <button className="vault-switch" onClick={() => onAction("vault-menu")}>
        <span className="vault-avatar">{vault.name.slice(0, 1).toUpperCase()}</span>
        <span>
          <strong>{vault.name}</strong>
          <small>Локальное хранилище</small>
        </span>
        <ChevronDown size={15} />
      </button>
      <div className="sidebar-tabs">
        <button
          className={section === "files" ? "active" : ""}
          onClick={() => setSection("files")}
          title="Файлы"
        >
          <Folder size={17} />
        </button>
        <button
          className={section === "search" ? "active" : ""}
          onClick={() => setSection("search")}
          title="Поиск"
        >
          <Search size={17} />
        </button>
        <button
          className={section === "bookmarks" ? "active" : ""}
          onClick={() => setSection("bookmarks")}
          title="Закладки"
        >
          <Star size={17} />
        </button>
        <button
          className={section === "tags" ? "active" : ""}
          onClick={() => setSection("tags")}
          title="Теги"
        >
          <Hash size={17} />
        </button>
      </div>
      <div className="sidebar-section-title">
        <span>
          {
            (
              {
                files: "ПРОВОДНИК",
                search: "ПОИСК",
                bookmarks: "ЗАКЛАДКИ",
                tags: "ТЕГИ",
              } as any
            )[section]
          }
        </span>
        {section === "files" && (
          <div>
            <button
              title="Новая заметка"
              aria-label="Новая заметка"
              onClick={() => onAction("new-note")}
            >
              <Plus size={16} />
            </button>
            <button
              title="Новая папка"
              aria-label="Новая папка"
              onClick={() => onAction("new-folder")}
            >
              <FolderPlus size={16} />
            </button>
          </div>
        )}
      </div>
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
                    className={"tree-row " + (active === file.path ? "active" : "")}
                    style={{
                      paddingLeft: 12 + file.path.split("/").length * 12 - 12,
                    }}
                    key={file.path}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContext(context === file.path ? null : file.path);
                    }}
                  >
                    <button
                      className="tree-file"
                      title={file.path}
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
                          <ChevronRight size={13} />
                        ) : (
                          <ChevronDown size={13} />
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
                      onClick={() => setContext(context === file.path ? null : file.path)}
                    >
                      <Ellipsis size={15} />
                    </button>
                    {context === file.path && (
                      <div className="file-context">
                        <button
                          onClick={() => {
                            setContext(null);
                            onFileAction("rename", file.path);
                          }}
                        >
                          Переименовать / переместить
                        </button>
                        <button
                          onClick={() => {
                            setContext(null);
                            onFileAction("reveal", file.path);
                          }}
                        >
                          Показать в Finder / Проводнике
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => {
                            setContext(null);
                            onFileAction("trash", file.path);
                          }}
                        >
                          В корзину
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!visible.length && (
              <div className="empty-small">Создайте первую заметку</div>
            )}
          </>
        )}
        {section === "search" && (
          <div className="search-panel">
            <input
              value={query}
              placeholder="Текст, tag:тег, path:папка"
              onChange={(e) => {
                const value = e.target.value;
                setQuery(value);
                api()
                  .search(value)
                  .then(setResults)
                  .catch(() => {});
              }}
            />
            <small className="muted">{results.length} совпадений</small>
            {results.map((r, i) => (
              <button
                className="search-result"
                key={r.path + i}
                onClick={() => onOpen(r.path)}
              >
                <strong>{r.path.replace(/\.md$/i, "")}</strong>
                <span>{r.text}</span>
                <small>Строка {r.line}</small>
              </button>
            ))}
          </div>
        )}
        {section === "bookmarks" &&
          (vault.preferences.bookmarks.length ? (
            vault.preferences.bookmarks.map((p) => (
              <button className="simple-row" key={p} onClick={() => onOpen(p)}>
                <Star size={14} />
                {p.replace(/\.md$/i, "")}
              </button>
            ))
          ) : (
            <div className="empty-small">Нажмите звезду в открытой заметке</div>
          ))}
        {section === "tags" &&
          tags.map((tag) => (
            <div key={tag}>
              <button
                className="simple-row"
                onClick={() => {
                  setSection("search");
                  setQuery("tag:" + tag);
                  api()
                    .search("tag:" + tag)
                    .then(setResults);
                }}
              >
                <Hash size={14} />
                {tag}
                <span className="count">
                  {index.filter((n) => n.tags.includes(tag)).length}
                </span>
              </button>
            </div>
          ))}
      </div>
      <div className="sidebar-bottom">
        <button onClick={() => onAction("import")}>
          <Import size={15} />
          Импорт из Obsidian
        </button>
        <span>
          {index.length} заметок · {vault.files.filter((f) => f.kind === "canvas").length}{" "}
          холстов
        </span>
      </div>
    </aside>
  );
}
