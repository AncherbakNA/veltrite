import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
export function useReadingFind(root: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [position, setPosition] = useState(0),
    [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.code !== "KeyF" ||
        event.shiftKey ||
        event.altKey ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (
        !root.current?.closest(".reading-pane") ||
        !root.current.closest(".focused-pane") ||
        (event.target as Element)?.closest?.(".cm-editor")
      )
        return;
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [enabled, root]);
  useEffect(() => {
    const marks = [
      ...(root.current?.querySelectorAll<HTMLElement>("mark[data-find-match]") || []),
    ].filter((mark) => mark.closest(".markdown") === root.current);
    setCount(marks.length);
    const active = marks.length
      ? ((position % marks.length) + marks.length) % marks.length
      : 0;
    for (let i = 0; i < marks.length; i++)
      marks[i].classList.toggle("find-current", i === active);
    if (marks[active]?.closest("[hidden]")) {
      for (const button of root.current?.querySelectorAll<HTMLButtonElement>(
        '.heading-fold[aria-expanded="false"],.callout-title[aria-expanded="false"]',
      ) || [])
        button.click();
    }
    const frame = requestAnimationFrame(() =>
      marks[active]?.scrollIntoView({ behavior: "auto", block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [query, position, root]);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const bar = open && (
    <div className="reading-find" role="search" aria-label="Поиск в заметке">
      <Search size={14} />
      <input
        ref={input}
        aria-label="Найти в заметке"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPosition(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setPosition((value) => value + (e.shiftKey ? -1 : 1));
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <small aria-live="polite">
        {count ? (((position % count) + count) % count) + 1 : 0} / {count}
        {count === 2000 ? "+" : ""}
      </small>
      <button
        aria-label="Предыдущее совпадение"
        onClick={() => setPosition((value) => value - 1)}
      >
        <ArrowUp size={14} />
      </button>
      <button
        aria-label="Следующее совпадение"
        onClick={() => setPosition((value) => value + 1)}
      >
        <ArrowDown size={14} />
      </button>
      <button aria-label="Закрыть поиск в заметке" onClick={close}>
        <X size={14} />
      </button>
    </div>
  );
  return { query, bar };
}
