import { headingId } from "../shared/markdown-blocks";

export function scrollToNoteAnchor(path: string, id: string, paneId?: string) {
  const roots = document.querySelectorAll<HTMLElement>(".reading-pane > .markdown");
  const root = [...roots].find(
    (element) =>
      element.dataset.markdownPath === path &&
      (!paneId ||
        element.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId === paneId),
  );
  const target = root?.querySelector<HTMLElement>("#" + CSS.escape(id));
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  return !!target;
}

export function scrollWithinMarkdown(link: HTMLElement, fragment: string) {
  let id = fragment;
  try {
    id = decodeURIComponent(id);
  } catch {}
  const root = link.closest<HTMLElement>(".markdown");
  if (!root) return false;
  const candidates = [id, headingId(id)];
  if (id.startsWith("^")) candidates.unshift("block-" + id.slice(1));
  const target = candidates
    .map((candidate) =>
      [...root.querySelectorAll<HTMLElement>("[id]")].find(
        (element) => element.id === candidate && element.closest(".markdown") === root,
      ),
    )
    .find(Boolean);
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  return !!target;
}
