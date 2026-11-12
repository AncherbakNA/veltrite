import {
  ArrowRight,
  CalendarDays,
  Clock3,
  FileText,
  FolderOpen,
  PanelsTopLeft,
  Plus,
  Table2,
} from "lucide-react";
import type { FileEntry, NoteIndex, VaultInfo } from "../../shared/types";
import { fileTitle, primaryKey } from "../ui";

interface WorkspaceHomeProps {
  vault: VaultInfo;
  index: NoteIndex[];
  recentPaths: string[];
  onOpen: (path: string) => void;
  onAction: (action: string) => void;
  onFilter: (kind: "all" | "note" | "canvas" | "base") => void;
}
export default function WorkspaceHome({
  vault,
  index,
  recentPaths,
  onOpen,
  onAction,
  onFilter,
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
    .slice(0, 10);
  const collections = [
    { kind: "note", Icon: FileText, label: "Заметки", count: index.length },
    {
      kind: "canvas",
      Icon: PanelsTopLeft,
      label: "Холсты",
      count: files.filter((file) => file.kind === "canvas").length,
    },
    {
      kind: "base",
      Icon: Table2,
      label: "Базы",
      count: files.filter((file) => file.kind === "base").length,
    },
  ] as const;
  return (
    <div className="workspace-home">
      <div className="home-heading">
        <div>
          <span className="home-path">
            <FolderOpen size={13} />
            Хранилище
          </span>
          <h1>{vault.name}</h1>
        </div>
        <button className="home-daily" onClick={() => onAction("daily")}>
          <CalendarDays size={16} />
          Заметка на сегодня
        </button>
      </div>
      <div className="home-collections" role="group" aria-label="Коллекции файлов">
        {collections.map(({ kind, Icon, label, count }) => (
          <button
            key={kind}
            aria-label={"Открыть " + label.toLocaleLowerCase()}
            onClick={() => onFilter(kind)}
          >
            <Icon size={16} />
            <span>{label}</span>
            <b>{count}</b>
          </button>
        ))}
      </div>
      <div className="home-create-actions">
        <button onClick={() => onAction("new-note")}>
          <Plus size={15} />
          Создать заметку<kbd>{primaryKey} N</kbd>
        </button>
        <button onClick={() => onAction("new-canvas")}>
          <PanelsTopLeft size={15} />
          Создать холст
        </button>
        <button onClick={() => onAction("new-base")}>
          <Table2 size={15} />
          Создать базу
        </button>
      </div>
      <section className="home-recent">
        <div className="home-section-heading">
          <div>
            <Clock3 size={15} />
            <h2>Недавние файлы</h2>
          </div>
          <button onClick={() => onAction("quick-open")}>
            Все файлы
            <ArrowRight size={14} />
          </button>
        </div>
        {recent.length ? (
          <div className="recent-files">
            {recent.map((file) => {
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
                  <Icon size={17} className={"kind-icon kind-" + file.kind} />
                  <span className="recent-file-name">{fileTitle(file.path)}</span>
                  <span className="recent-file-folder">
                    {file.path.includes("/")
                      ? file.path.split("/").slice(0, -1).join(" / ")
                      : "—"}
                  </span>
                  <span className="recent-file-type">
                    {file.kind === "canvas"
                      ? "Холст"
                      : file.kind === "base"
                        ? "База"
                        : "Заметка"}
                  </span>
                  <time>
                    {new Date(file.modified).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "short",
                    })}
                  </time>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="home-first-note">
            <p>В хранилище пока нет файлов.</p>
            <button onClick={() => onAction("new-note")}>
              <Plus size={15} />
              Создать первую заметку
            </button>
          </div>
        )}
      </section>
      <div className="home-shortcuts">
        <span>
          Перейти к файлу <kbd>{primaryKey} O</kbd>
        </span>
        <span>
          Команды <kbd>{primaryKey} P</kbd>
        </span>
      </div>
    </div>
  );
}
