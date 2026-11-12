import { ChevronLeft, ChevronRight, Maximize, X } from "lucide-react";
import { useMemo, useState } from "react";
import { frontmatter } from "../../shared/markdown";
import { splitSlides } from "../../shared/slides";
import type { NoteIndex } from "../../shared/types";
import { useDialogFocus } from "../useDialogFocus";
import Markdown from "./Markdown";
export default function Slides({
  content,
  path,
  index,
  onLink,
  onClose,
}: {
  content: string;
  path: string;
  index: NoteIndex[];
  onLink: (target: string) => void;
  onClose: () => void;
}) {
  const root = useDialogFocus<HTMLDivElement>(),
    slides = useMemo(() => splitSlides(frontmatter(content).body), [content]),
    [position, setPosition] = useState(0),
    current = Math.min(position, slides.length - 1);
  const next = (delta: number) =>
    setPosition((value) => Math.max(0, Math.min(slides.length - 1, value + delta)));
  return (
    <div
      ref={root}
      className="slides-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Слайды"
      tabIndex={-1}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches("input,textarea,select")) return;
        if (["ArrowRight", "PageDown", " "].includes(event.key)) {
          event.preventDefault();
          next(event.shiftKey ? -1 : 1);
        }
        if (["ArrowLeft", "PageUp"].includes(event.key)) {
          event.preventDefault();
          next(-1);
        }
        if (event.key === "Home") setPosition(0);
        if (event.key === "End") setPosition(slides.length - 1);
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <button
        className="slides-close icon-button"
        aria-label="Закрыть слайды"
        onClick={onClose}
      >
        <X size={24} />
      </button>
      <div className="slide">
        <Markdown
          content={slides[current] || ""}
          path={path}
          index={index}
          onLink={onLink}
        />
      </div>
      <div className="slides-controls">
        <button
          aria-label="Предыдущий слайд"
          disabled={!current}
          onClick={() => next(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {current + 1} / {slides.length}
        </span>
        <button
          aria-label="Следующий слайд"
          disabled={current === slides.length - 1}
          onClick={() => next(1)}
        >
          <ChevronRight size={18} />
        </button>
        <button
          aria-label="Слайды на весь экран"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void root.current?.requestFullscreen();
          }}
        >
          <Maximize size={16} />
        </button>
      </div>
    </div>
  );
}
