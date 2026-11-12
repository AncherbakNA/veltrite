import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  PenLine,
  Star,
} from "lucide-react";
import type { EditorMode } from "../commands";
import { primaryKey } from "../ui";

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
  const visual = /\.(canvas|base)$/i.test(path);
  const reading = mode === "read";
  return (
    <div className="document-toolbar">
      <div className="breadcrumb" title={path}>
        <button
          className="icon-button"
          title="Назад"
          aria-label="Назад"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ChevronLeft size={16} />
        </button>
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
        {visual && mode === "source" && (
          <button className="reading-toggle" onClick={() => setMode("live")}>
            {path.endsWith(".canvas") ? "Холст" : "Представление"}
          </button>
        )}
        {!visual && (
          <button
            className="reading-toggle"
            aria-label={reading ? "Правка" : "Чтение"}
            title={`${reading ? "Перейти к правке" : "Перейти к чтению"} (${primaryKey}E)`}
            onClick={() => setMode(reading ? "live" : "read")}
          >
            {reading ? <PenLine size={16} /> : <BookOpen size={16} />}
            <span>{reading ? "Правка" : "Чтение"}</span>
          </button>
        )}
        <button
          className={"icon-button " + (bookmarked ? "starred" : "")}
          aria-label="Закладка"
          aria-pressed={bookmarked}
          title={bookmarked ? "Убрать из закладок" : "Добавить в закладки"}
          onClick={onBookmark}
        >
          <Star size={16} />
        </button>
        <button
          className="icon-button"
          title="Действия с документом"
          aria-label="Действия с документом"
          onClick={onActions}
        >
          <Ellipsis size={16} />
        </button>
      </div>
    </div>
  );
}
