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
