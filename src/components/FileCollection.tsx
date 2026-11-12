import {
  ArrowUpRight,
  ChevronLeft,
  FileText,
  PanelsTopLeft,
  Plus,
  Search,
  Table2,
} from "lucide-react";
import { useState } from "react";
import type { FileEntry, NoteIndex } from "../../shared/types";
import { fileTitle } from "../ui";
import type { FileFilter } from "./Sidebar";

interface FileCollectionProps {
  kind: FileFilter;
  files: FileEntry[];
  index: NoteIndex[];
  onOpen: (path: string) => void;
  onHome: () => void;
  onCreate: (action: string) => void;
}
const collections = {
  all: {
    title: "Все файлы",
    description: "Заметки, холсты и базы вашего пространства.",
    action: "new-note",
    create: "Новая заметка",
    Icon: FileText,
  },
  note: {
    title: "Заметки",
    description: "Мысли и знания, к которым хочется вернуться.",
    action: "new-note",
    create: "Новая заметка",
    Icon: FileText,
  },
  canvas: {
    title: "Холсты",
    description: "Соберите идеи рядом и посмотрите на общую картину.",
    action: "new-canvas",
    create: "Новый холст",
    Icon: PanelsTopLeft,
  },
  base: {
    title: "Базы",
    description: "Ваши заметки в таблицах, карточках и на досках.",
    action: "new-base",
    create: "Новая база",
    Icon: Table2,
  },
} as const;

export default function FileCollection({
  kind,
  files,
  index,
  onOpen,
  onHome,
  onCreate,
}: FileCollectionProps) {
  const [query, setQuery] = useState("");
  const info = collections[kind];
  const notes = new Map(index.map((note) => [note.path, note]));
  const matching = files.filter(
    (file) =>
      ["note", "canvas", "base"].includes(file.kind) &&
      (kind === "all" || file.kind === kind),
  );
  const results = matching
    .filter((file) =>
      [
        file.path,
        notes.get(file.path)?.title || "",
        ...(notes.get(file.path)?.tags || []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => b.modified - a.modified);
  return (
    <section className="file-collection">
      <button className="collection-back" onClick={onHome}>
        <ChevronLeft size={14} />
        Главная
      </button>
      <div className="collection-heading">
        <div>
          <span className="collection-symbol">
            <info.Icon size={25} />
          </span>
          <h1>{info.title}</h1>
          <p>{info.description}</p>
        </div>
        <button className="primary" onClick={() => onCreate(info.action)}>
          <Plus size={16} />
          {info.create}
        </button>
      </div>
      <div className="collection-tools">
        <span>Всего: {matching.length}</span>
        <label>
          <Search size={15} />
          <input
            value={query}
            placeholder="Найти среди файлов…"
            aria-label="Найти среди файлов"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {results.length ? (
        <div className="collection-grid">
          {results.map((file) => {
            const Icon =
              file.kind === "canvas"
                ? PanelsTopLeft
                : file.kind === "base"
                  ? Table2
                  : FileText;
            const note = notes.get(file.path);
            return (
              <button
                className={"collection-card kind-" + file.kind}
                key={file.path}
                onClick={() => onOpen(file.path)}
                title={file.path}
              >
                <span className="collection-card-top">
                  <Icon size={20} />
                  <span>
                    {file.kind === "canvas"
                      ? "Холст"
                      : file.kind === "base"
                        ? "База"
                        : "Заметка"}
                  </span>
                  <ArrowUpRight size={14} />
                </span>
                <strong>{fileTitle(file.path)}</strong>
                <small>
                  {file.path.includes("/")
                    ? file.path.split("/").slice(0, -1).join(" / ")
                    : "В корне хранилища"}
                </small>
                <span className="collection-card-bottom">
                  <span>
                    {note?.tags.slice(0, 2).map((tag) => (
                      <span className="tag" key={tag}>
                        #{tag}
                      </span>
                    ))}
                  </span>
                  <time>
                    {new Date(file.modified).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="collection-empty">
          <info.Icon size={32} />
          <h2>{query ? "Ничего не найдено" : "Здесь пока пусто"}</h2>
          <p>
            {query
              ? "Попробуйте другое название, папку или тег."
              : "Добавьте первый файл — он появится здесь."}
          </p>
          {!query && (
            <button className="text-link" onClick={() => onCreate(info.action)}>
              <Plus size={15} />
              {info.create}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
