import { FileText, PanelsTopLeft, Plus, Star, Table2 } from "lucide-react";
import { modifiedAgo } from "../../shared/format";
import type { FileEntry, VaultInfo } from "../../shared/types";
import { fileTitle } from "../ui";

interface WorkspaceHomeProps {
  vault: VaultInfo;
  recentPaths: string[];
  onOpen: (path: string) => void;
  onAction: (action: string) => void;
}
export default function WorkspaceHome({
  vault,
  recentPaths,
  onOpen,
  onAction,
}: WorkspaceHomeProps) {
  const files = vault.files.filter((file) =>
    ["note", "canvas", "base"].includes(file.kind),
  );
  const recent = [
    ...new Set([
      ...recentPaths.slice().reverse(),
      ...files
        .slice()
        .sort((a, b) => b.modified - a.modified)
        .map((file) => file.path),
    ]),
  ]
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is FileEntry => !!file)
    .slice(0, 12);
  const bookmarks = vault.preferences.bookmarks
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is FileEntry => !!file);
  const rows = (entries: FileEntry[]) => (
    <div className="recent-files">
      {entries.map((file) => {
        const Icon =
          file.kind === "canvas"
            ? PanelsTopLeft
            : file.kind === "base"
              ? Table2
              : FileText;
        return (
          <button
            className="recent-file"
            key={file.path}
            title={file.path}
            onClick={() => onOpen(file.path)}
          >
            <Icon size={16} />
            <span className="recent-file-name">{fileTitle(file.path)}</span>
            <span className="recent-file-folder">
              {file.path.includes("/")
                ? file.path.split("/").slice(0, -1).join(" / ")
                : "—"}
            </span>
            <time
              dateTime={new Date(file.modified).toISOString()}
              title={new Date(file.modified).toLocaleString("ru-RU")}
            >
              {modifiedAgo(file.modified)}
            </time>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="workspace-home">
      <h1>Главная</h1>
      <div className="home-create-actions">
        <button onClick={() => onAction("new-note")}>
          <Plus size={16} />
          Новая заметка
        </button>
        <button onClick={() => onAction("new-canvas")}>
          <PanelsTopLeft size={16} />
          Новый холст
        </button>
        <button onClick={() => onAction("new-base")}>
          <Table2 size={16} />
          Новая база
        </button>
      </div>
      {!files.length ? (
        <div className="home-first-note">
          <p>В хранилище пока нет файлов.</p>
          <p>
            Создайте заметку через «+» или перетащите файлы в папку хранилища. Для ссылки
            между заметками используйте <code>[[Название]]</code>.
          </p>
        </div>
      ) : (
        <>
          <section className="home-recent">
            <h2>Недавние файлы</h2>
            {rows(recent)}
          </section>
          {bookmarks.length > 0 && (
            <section className="home-bookmarks">
              <h2>
                <Star size={16} />
                Закладки
              </h2>
              {rows(bookmarks)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
