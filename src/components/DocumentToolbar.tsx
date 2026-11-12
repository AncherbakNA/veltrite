import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Code2,
  Columns2,
  Ellipsis,
  FileText,
  PanelsTopLeft,
  PenLine,
  Star,
  Table2,
} from "lucide-react";
import type { EditorMode } from "../commands";

interface DocumentToolbarProps {
  path: string;
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  canGoBack: boolean;
  onBack: () => void;
  bookmarked: boolean;
  onBookmark: () => void;
  onActions: () => void;
}

export default function DocumentToolbar({
  path,
  mode,
  setMode,
  canGoBack,
  onBack,
  bookmarked,
  onBookmark,
  onActions,
}: DocumentToolbarProps) {
  const canvas = /\.canvas$/i.test(path),
    base = /\.base$/i.test(path);
  const Icon = canvas ? PanelsTopLeft : base ? Table2 : FileText;
  const modes =
    canvas || base
      ? [
          {
            id: "live",
            label: canvas ? "Холст" : "Представление",
            title: canvas ? "Холст" : "Визуальный режим базы",
            Icon,
          },
          { id: "source", label: "Код", title: "Исходный код", Icon: Code2 },
        ]
      : [
          { id: "live", label: "Редактор", title: "Редактор", Icon: PenLine },
          { id: "source", label: "Код", title: "Исходный код", Icon: Code2 },
          { id: "read", label: "Чтение", title: "Чтение", Icon: BookOpen },
          {
            id: "split",
            label: "Рядом",
            title: "Редактор и предпросмотр",
            Icon: Columns2,
          },
        ];
  return (
    <div className="document-toolbar">
      <div className="breadcrumb" title={path}>
        <button
          className="icon-button"
          title="Назад"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ChevronLeft size={16} />
        </button>
        <Icon size={15} className="document-kind-icon" />
        <div className="breadcrumb-path">
          {path.split("/").map((part, i, parts) => (
            <span key={i}>
              {part.replace(/\.(md|canvas|base)$/i, "")}
              {i < parts.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
        </div>
      </div>
      <div className="document-tools">
        <div className="view-toggle" role="group" aria-label="Режим просмотра">
          {modes.map(({ id, label, title, Icon: ModeIcon }) => (
            <button
              key={id}
              title={title}
              aria-label={title}
              aria-pressed={
                mode === id || ((canvas || base) && id === "live" && mode !== "source")
              }
              className={
                mode === id || ((canvas || base) && id === "live" && mode !== "source")
                  ? "active"
                  : ""
              }
              onClick={() => setMode(id as EditorMode)}
            >
              <ModeIcon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <button
          className={"icon-button " + (bookmarked ? "starred" : "")}
          aria-label="Закладка"
          aria-pressed={bookmarked}
          title={bookmarked ? "Убрать из закладок" : "Добавить в закладки"}
          onClick={onBookmark}
        >
          <Star size={17} />
        </button>
        <button className="icon-button" title="Действия с заметкой" onClick={onActions}>
          <Ellipsis size={19} />
        </button>
      </div>
    </div>
  );
}
