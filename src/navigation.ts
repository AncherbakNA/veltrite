import { headingId } from "../shared/markdown-blocks";
import { editorSnapshot } from "./editorInsertion";

const requests = new Map<string, number>();
/** Attempt immediately, then wait for the actual pane mount instead of guessing a delay. */
export function navigateToNote(
  path: string,
  paneId: string,
  mode: string,
  id: string,
  line?: number,
): Promise<void> {
  const request = (requests.get(paneId) || 0) + 1;
  requests.set(paneId, request);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const attempt = () => {
      if (requests.get(paneId) !== request) {
        resolve();
        return;
      }
      if (
        (mode === "read" || mode === "split") &&
        id &&
        scrollToNoteAnchor(path, id, paneId)
      ) {
        resolve();
        return;
      }
      if (mode !== "read" && line && editorSnapshot(path, paneId)) {
        window.dispatchEvent(
          new CustomEvent("veltrite:goto", { detail: { path, paneId, line } }),
        );
        resolve();
        return;
      }
      if (performance.now() - started > 5000) {
        reject(Error("Не удалось найти фрагмент в открытой заметке"));
        return;
      }
      requestAnimationFrame(attempt);
    };
    attempt();
  });
}

export function scrollToNoteAnchor(path: string, id: string, paneId?: string) {
  const roots = document.querySelectorAll<HTMLElement>(".reading-pane > .markdown");
  const root = [...roots].find(
    (element) =>
      element.dataset.markdownPath === path &&
      (!paneId ||
        element.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId === paneId),
  );
  const target = root?.querySelector<HTMLElement>("#" + CSS.escape(id));
  if (target?.hidden) {
    // Opening an anchor also opens a containing folded section.
    for (const heading of root?.querySelectorAll<HTMLButtonElement>(
      '.heading-fold[aria-expanded="false"]',
    ) || [])
      heading.click();
  }
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

export async function readingForExport(path: string, pane: string): Promise<HTMLElement> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const find = () => {
      const root = [
        ...document.querySelectorAll<HTMLElement>(".reading-pane > .markdown"),
      ].find(
        (node) =>
          node.dataset.markdownPath === path &&
          node.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId === pane,
      );
      if (root && !root.querySelector("[data-render-pending]")) {
        resolve(root);
        return;
      }
      if (performance.now() - started > 10000) {
        reject(Error("Документ ещё не готов к экспорту"));
        return;
      }
      requestAnimationFrame(find);
    };
    find();
  });
}
