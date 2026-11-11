import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { frontmatter, resolveLink } from "../../shared/markdown";
import type { NoteIndex } from "../../shared/types";
import { api } from "../useVault";
import { VaultFilesContext } from "../VaultContext";

export default function NoteLink({
  target,
  from,
  index,
  onOpen,
  children,
}: {
  target: string;
  from: string;
  index: NoteIndex[];
  onOpen: (target: string) => void;
  children: ReactNode;
}) {
  const paths = useContext(VaultFilesContext),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    hovering = useRef(false);
  const [preview, setPreview] = useState<{
    title: string;
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const hide = () => {
    hovering.current = false;
    if (timer.current) clearTimeout(timer.current);
    setPreview(null);
  };
  useEffect(
    () => () => {
      hovering.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = (element: HTMLAnchorElement) => {
    hovering.current = true;
    const resolved = resolveLink(target, from, paths, index);
    if (!resolved?.toLowerCase().endsWith(".md")) return;
    const rect = element.getBoundingClientRect();
    timer.current = setTimeout(
      () =>
        api()
          .read(resolved)
          .then((note) => {
            if (hovering.current)
              setPreview({
                title: resolved.replace(/\.md$/i, ""),
                text: frontmatter(note.content).body.slice(0, 900),
                x: Math.max(12, Math.min(rect.left, window.innerWidth - 360)),
                y: Math.min(rect.bottom + 12, window.innerHeight - 270),
              });
          })
          .catch(() => {}),
      300,
    );
  };
  return (
    <>
      <a
        href={"#vlt:" + encodeURIComponent(target)}
        title={target}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={hide}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={hide}
        onClick={(event) => {
          event.preventDefault();
          hide();
          onOpen(target);
        }}
      >
        {children}
      </a>
      {preview &&
        createPortal(
          <aside
            className="note-hover"
            role="tooltip"
            style={{ left: preview.x, top: preview.y }}
          >
            <strong>{preview.title}</strong>
            <p>{preview.text}</p>
          </aside>,
          document.body,
        )}
    </>
  );
}
