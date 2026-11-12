import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  GitBranch,
  Hash,
  Pencil,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  allBookmarks,
  mapBookmarks,
  moveBookmark,
  type Bookmark,
} from "../../shared/bookmarks";

export default function Bookmarks({
  items,
  onChange,
  onOpen,
  onSaveSearch,
}: {
  items: Bookmark[];
  onChange: (items: Bookmark[]) => void;
  onOpen: (item: Bookmark) => void;
  onSaveSearch: () => void;
}) {
  const [closed, setClosed] = useState(new Set<string>()),
    [menu, setMenu] = useState<string | null>(null),
    [editing, setEditing] = useState<Bookmark | null>(null),
    [name, setName] = useState("");
  const groups = allBookmarks(items).filter((item) => item.type === "group");
  const label = (item: Bookmark): string =>
    item.title ||
    (item.type === "file"
      ? item.path.replace(/\.md$/i, "") + (item.fragment ? " #" + item.fragment : "")
      : item.type === "folder"
        ? item.path
        : item.type === "search"
          ? item.query
          : item.type === "url"
            ? item.url
            : item.type === "graph"
              ? "Граф знаний"
              : "Группа");
  const edit = (item: Bookmark) => {
    setEditing(item);
    setName(label(item));
    setMenu(null);
  };
  const render = (values: Bookmark[], parent: string | null, depth: number) =>
    values.map((item, position) => {
      const Icon =
        item.type === "group" || item.type === "folder"
          ? Folder
          : item.type === "file"
            ? item.fragment
              ? Hash
              : FileText
            : item.type === "search"
              ? Search
              : item.type === "url"
                ? ExternalLink
                : GitBranch;
      return (
        <div
          key={item.id}
          className="bookmark-item"
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData("application/x-veltrite-bookmark", item.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = e.dataTransfer.getData("application/x-veltrite-bookmark");
            onChange(
              moveBookmark(
                items,
                id,
                item.type === "group" ? item.id : parent,
                item.type === "group" ? undefined : item.id,
              ),
            );
          }}
        >
          <div className="bookmark-row" style={{ paddingLeft: 8 + depth * 14 }}>
            <button
              className="bookmark-open"
              title={label(item)}
              onClick={() => {
                if (item.type === "group")
                  setClosed((old) => {
                    const next = new Set(old);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  });
                else onOpen(item);
              }}
            >
              {item.type === "group" ? (
                <ChevronRight
                  size={13}
                  className={!closed.has(item.id) ? "expanded" : ""}
                />
              ) : (
                <Icon size={14} />
              )}
              <span>{label(item)}</span>
            </button>
            <button
              className="icon-button bookmark-more"
              aria-label={"Изменить закладку «" + label(item) + "»"}
              onClick={() => setMenu(menu === item.id ? null : item.id)}
            >
              <Pencil size={12} />
            </button>
          </div>
          {menu === item.id && (
            <div className="bookmark-actions">
              <button onClick={() => edit(item)}>Переименовать</button>
              <button
                aria-label="Закладка выше"
                disabled={!position}
                onClick={() =>
                  onChange(moveBookmark(items, item.id, parent, values[position - 1].id))
                }
              >
                <ArrowUp size={14} />
              </button>
              <button
                aria-label="Закладка ниже"
                disabled={position === values.length - 1}
                onClick={() =>
                  onChange(moveBookmark(items, values[position + 1].id, parent, item.id))
                }
              >
                <ArrowDown size={14} />
              </button>
              <button
                aria-label="Удалить закладку"
                onClick={() => {
                  onChange(
                    mapBookmarks(items, (value) => (value.id === item.id ? null : value)),
                  );
                  setMenu(null);
                }}
              >
                <Trash2 size={14} />
              </button>
              <select
                aria-label="Переместить закладку в группу"
                value={parent || ""}
                onChange={(e) =>
                  onChange(moveBookmark(items, item.id, e.target.value || null))
                }
              >
                <option value="">В корень</option>
                {groups
                  .filter(
                    (group) =>
                      group.id !== item.id &&
                      !(
                        item.type === "group" &&
                        allBookmarks(item.children).some((child) => child.id === group.id)
                      ),
                  )
                  .map((group) => (
                    <option value={group.id} key={group.id}>
                      {label(group)}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {item.type === "group" &&
            !closed.has(item.id) &&
            render(item.children, item.id, depth + 1)}
        </div>
      );
    });
  return (
    <div className="bookmarks-panel">
      <div className="bookmark-tools">
        <button
          onClick={() => {
            const item: Bookmark = {
              id: crypto.randomUUID(),
              title: "Новая группа",
              type: "group",
              children: [],
            };
            onChange([...items, item]);
            edit(item);
          }}
        >
          <FolderPlus size={14} />
          Группа
        </button>
        <button onClick={onSaveSearch}>
          <Search size={14} />
          Сохранить поиск
        </button>
      </div>
      {editing && (
        <form
          className="bookmark-edit"
          onSubmit={(e) => {
            e.preventDefault();
            onChange(
              mapBookmarks(items, (item) =>
                item.id === editing.id ? { ...item, title: name.trim() } : item,
              ),
            );
            setEditing(null);
          }}
        >
          <input
            aria-label="Название закладки"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={500}
          />
          <button type="submit">Сохранить</button>
          <button
            type="button"
            aria-label="Отмена переименования"
            onClick={() => setEditing(null)}
          >
            <X size={14} />
          </button>
        </form>
      )}
      <div
        className="bookmark-root"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onChange(
            moveBookmark(
              items,
              e.dataTransfer.getData("application/x-veltrite-bookmark"),
              null,
            ),
          );
        }}
      >
        {render(items, null, 0)}
        {!items.length && (
          <div className="sidebar-empty">
            <Star size={24} />
            <strong>Нет закладок</strong>
            <p>Сохраните файл, заголовок, папку или поисковый запрос.</p>
          </div>
        )}
      </div>
    </div>
  );
}
