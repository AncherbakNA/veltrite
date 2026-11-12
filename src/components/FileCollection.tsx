import { FileText, PanelsTopLeft, Plus, Search, Table2 } from "lucide-react";
import { useState } from "react";
import type { FileEntry, NoteIndex } from "../../shared/types";
import { fileTitle } from "../ui";
import type { FileFilter } from "./Sidebar";
interface FileCollectionProps {
  kind: FileFilter;
  files: FileEntry[];
  index: NoteIndex[];
  onOpen: (path: string) => void;
  onCreate: (action: string) => void;
}
const collections = {
  all: { title: "Все файлы", action: "new-note", create: "Новая заметка" },
  note: { title: "Заметки", action: "new-note", create: "Новая заметка" },
  canvas: { title: "Холсты", action: "new-canvas", create: "Новый холст" },
  base: { title: "Базы", action: "new-base", create: "Новая база" },
};
export default function FileCollection({
  kind,
  files,
  index,
  onOpen,
  onCreate,
}: FileCollectionProps) {
  const [query, setQuery] = useState("");
  const info = collections[kind],
    notes = new Map(index.map((note) => [note.path, note]));
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
      <div className="collection-heading">
        <h1>{info.title}</h1>
        <button onClick={() => onCreate(info.action)}>
          <Plus size={16} />
          {info.create}
        </button>
      </div>
      <div className="collection-tools">
        <span>Всего: {matching.length}</span>
        <label>
          <Search size={16} />
          <input
            value={query}
            placeholder="Найти среди файлов…"
            aria-label="Найти среди файлов"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {results.length ? (
        <table className="collection-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Папка</th>
              <th>Изменено</th>
            </tr>
          </thead>
          <tbody>
            {results.map((file) => {
              const Icon =
                file.kind === "canvas"
                  ? PanelsTopLeft
                  : file.kind === "base"
                    ? Table2
                    : FileText;
              return (
                <tr
                  key={file.path}
                  className={"collection-row kind-" + file.kind}
                  onClick={() => onOpen(file.path)}
                >
                  <td>
                    <button
                      className="collection-open"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(file.path);
                      }}
                      title={file.path}
                    >
                      <Icon size={16} />
                      {fileTitle(file.path)}
                    </button>
                  </td>
                  <td>
                    {file.path.includes("/")
                      ? file.path.split("/").slice(0, -1).join(" / ")
                      : "—"}
                  </td>
                  <td>
                    <time
                      dateTime={new Date(file.modified).toISOString()}
                      title={new Date(file.modified).toLocaleString("ru-RU")}
                    >
                      {new Date(file.modified).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="collection-empty">
          <h2>{query ? "Ничего не найдено" : "Нет файлов"}</h2>
          {query && <p>Измените название, папку или тег в запросе.</p>}
        </div>
      )}
    </section>
  );
}
