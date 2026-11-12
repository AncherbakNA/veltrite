import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  FileText,
  GitBranch,
  Link2,
  PanelsTopLeft,
  Plus,
  Search,
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
    .slice(0, 6);
  const date = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const metrics = [
    {
      kind: "note",
      Icon: FileText,
      label: "Заметки",
      description: "Идеи и знания",
      count: index.length,
    },
    {
      kind: "canvas",
      Icon: PanelsTopLeft,
      label: "Холсты",
      description: "Большая картина",
      count: files.filter((file) => file.kind === "canvas").length,
    },
    {
      kind: "base",
      Icon: Table2,
      label: "Базы",
      description: "Порядок в заметках",
      count: files.filter((file) => file.kind === "base").length,
    },
  ] as const;
  return (
    <div className="workspace-home">
      <div className="home-heading">
        <div>
          <span className="home-date">{date}</span>
          <h1>
            Всё начинается с мысли<span>.</span>
          </h1>
          <p>Продолжите начатое или дайте место новой идее.</p>
        </div>
        <button className="home-daily" onClick={() => onAction("daily")}>
          <CalendarDays size={18} />
          <span>
            Заметка дня<small>Немного о сегодняшнем</small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="home-metrics">
        {metrics.map(({ kind, Icon, label, description, count }) => (
          <button
            className={"home-metric metric-" + kind}
            aria-label={"Открыть " + label.toLocaleLowerCase()}
            key={kind}
            onClick={() => onFilter(kind)}
          >
            <span className="metric-icon">
              <Icon size={19} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <b>{count}</b>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      <section className="home-recent">
        <div className="home-section-heading">
          <div>
            <Clock3 size={16} />
            <h2>Продолжить работу</h2>
          </div>
          <button onClick={() => onAction("quick-open")}>
            Все файлы <ArrowRight size={14} />
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
                  <span className={"recent-file-icon kind-" + file.kind}>
                    <Icon size={18} />
                  </span>
                  <span>
                    <strong>{fileTitle(file.path)}</strong>
                    <small>
                      {file.path.includes("/")
                        ? file.path.split("/").slice(0, -1).join(" / ")
                        : "В корне хранилища"}
                    </small>
                  </span>
                  <span className="recent-file-type">
                    {file.kind === "canvas"
                      ? "Холст"
                      : file.kind === "base"
                        ? "База"
                        : "Заметка"}
                  </span>
                  <ArrowUpRight size={15} className="recent-file-arrow" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="home-first-note">
            <FileText size={25} />
            <h3>Место для первой заметки</h3>
            <p>Запишите идею, план или то, что хочется запомнить.</p>
            <button className="primary" onClick={() => onAction("new-note")}>
              <Plus size={16} />
              Создать первую заметку
            </button>
          </div>
        )}
      </section>
      <section className="home-bottom-grid">
        <div className="home-create-card">
          <span className="eyebrow">НОВАЯ ИДЕЯ</span>
          <h2>Как удобнее думать?</h2>
          <p>Текстом, карточками или связями — выбирайте под задачу.</p>
          <div className="home-create-actions">
            <button onClick={() => onAction("new-note")}>
              <FileText size={17} />
              <span>Создать заметку</span>
              <kbd>{primaryKey} N</kbd>
            </button>
            <button onClick={() => onAction("new-canvas")}>
              <PanelsTopLeft size={17} />
              <span>Создать холст</span>
              <ArrowUpRight size={14} />
            </button>
            <button onClick={() => onAction("new-base")}>
              <Table2 size={17} />
              <span>Создать базу</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        <div className="home-connections">
          <div className="connection-art" aria-hidden="true">
            <span>
              <FileText size={18} />
            </span>
            <i />
            <span>
              <Link2 size={20} />
            </span>
            <i />
            <span>
              <FileText size={18} />
            </span>
          </div>
          <span className="eyebrow">СВЯЗЫВАЙТЕ МЫСЛИ</span>
          <h2>Одна заметка ведёт к другой.</h2>
          <p>
            Напишите <code>[[Название]]</code> в тексте. Связи появятся в графе и помогут
            заметить общую картину.
          </p>
          <button onClick={() => onAction("graph")}>
            <GitBranch size={16} />
            Исследовать связи
            <ArrowRight size={14} />
          </button>
        </div>
      </section>
      <div className="home-keyboard-hint">
        <Search size={13} />
        <span>Любой файл всегда рядом</span>
        <kbd>{primaryKey} O</kbd>
        <span className="home-keyboard-divider" />
        <span>Все инструменты</span>
        <kbd>{primaryKey} P</kbd>
      </div>
    </div>
  );
}
