import { relativeLink } from "../shared/links";
import { resolveLink } from "../shared/markdown";
import { headingId } from "../shared/markdown-blocks";
import type { NoteIndex } from "../shared/types";
function canvasImage(
  source: HTMLCanvasElement,
  document: Document,
): HTMLImageElement | null {
  try {
    if (!source.width || !source.height) return null;
    const image = document.createElement("img");
    image.src = source.toDataURL("image/png");
    image.width = source.clientWidth || source.width;
    return image;
  } catch {
    return null;
  }
}
/** Export a finished document with expanded content and inert, readable controls. */
export function exportDocument(
  root: HTMLElement,
  path: string,
  paths: string[],
  index: NoteIndex[],
  site = false,
): string {
  const clone = root.cloneNode(true) as HTMLElement,
    document = clone.ownerDocument;
  const originalCanvases = [...root.querySelectorAll("canvas")];
  for (const [i, canvas] of [...clone.querySelectorAll("canvas")].entries())
    canvas.replaceWith(
      canvasImage(originalCanvases[i], document) || document.createElement("span"),
    );
  for (const viewer of clone.querySelectorAll(".pdf-viewer")) {
    const figure = document.createElement("figure"),
      image = viewer.querySelector(".pdf-page img"),
      caption = document.createElement("figcaption");
    caption.textContent =
      (viewer.getAttribute("data-pdf-path") || "PDF") +
      " · стр. " +
      (viewer.querySelector<HTMLInputElement>('[aria-label="Страница PDF"]')?.value ||
        "1");
    if (image) figure.append(image);
    figure.append(caption);
    viewer.replaceWith(figure);
  }
  for (const element of clone.querySelectorAll("[hidden]"))
    element.removeAttribute("hidden");
  for (const element of clone.querySelectorAll(
    ".reading-find,.heading-fold,.cm-block-edit,.canvas-topbar,.canvas-controls,.canvas-resize,.graph-toolbar,.base-loading,.base-map-controls,.textLayer",
  ))
    element.remove();
  for (const input of clone.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  )) {
    if (input.checked) input.setAttribute("checked", "");
    else input.removeAttribute("checked");
    input.setAttribute("disabled", "");
  }
  for (const embed of clone.querySelectorAll<HTMLElement>(
    ".embed-content[data-embed-target]",
  )) {
    const title = embed.querySelector(".embed-title");
    if (!title) continue;
    const anchor = document.createElement("a");
    anchor.textContent = title.textContent;
    anchor.href = "#vlt:" + encodeURIComponent(embed.dataset.embedTarget!);
    title.replaceWith(anchor);
  }
  for (const button of clone.querySelectorAll("button")) {
    const span = document.createElement("span");
    span.className = button.className;
    span.replaceChildren(...button.childNodes);
    button.replaceWith(span);
  }
  for (const select of clone.querySelectorAll("select")) {
    const span = document.createElement("span");
    span.textContent = [...select.selectedOptions]
      .map((option) => option.textContent)
      .join(", ");
    select.replaceWith(span);
  }
  for (const input of clone.querySelectorAll<HTMLInputElement>(
    'input:not([type="checkbox"]),textarea',
  )) {
    const span = document.createElement("span");
    span.textContent = input.value;
    input.replaceWith(span);
  }
  for (const anchor of clone.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const original = anchor.getAttribute("href")!,
      target = original.startsWith("#vlt:")
        ? decodeURIComponent(original.slice(5))
        : original;
    if (/^(https?:|mailto:)/i.test(target)) continue;
    if (!original.startsWith("#vlt:") && target.startsWith("#")) continue;
    const resolved = resolveLink(target, path, paths, index);
    if (!resolved) {
      anchor.removeAttribute("href");
      anchor.title = target;
      continue;
    }
    const fragment = target.includes("#") ? target.slice(target.indexOf("#") + 1) : "";
    const id = fragment.startsWith("^")
      ? "block-" + fragment.slice(1)
      : headingId(fragment);
    if (site)
      anchor.setAttribute(
        "href",
        relativeLink(
          "notes/" + path.replace(/\.md$/i, ".html"),
          resolved.endsWith(".md")
            ? "notes/" + resolved.replace(/\.md$/i, ".html")
            : "files/" + resolved,
        ) + (id ? "#" + encodeURIComponent(id) : ""),
      );
    else if (resolved === path && id)
      anchor.setAttribute("href", "#" + encodeURIComponent(id));
    else {
      anchor.removeAttribute("href");
      anchor.title = target;
    }
  }
  for (const element of clone.querySelectorAll<HTMLElement>("[src]")) {
    const source = element.getAttribute("src") || "";
    if (site && source.startsWith("veltrite-asset://vault/"))
      element.setAttribute(
        "src",
        relativeLink(
          "notes/" + path.replace(/\.md$/i, ".html"),
          "files/" + decodeURIComponent(source.slice("veltrite-asset://vault/".length)),
        ),
      );
  }
  for (const element of [clone, ...clone.querySelectorAll<HTMLElement>("*")])
    for (const attribute of [...element.attributes])
      if (
        /^on/i.test(attribute.name) ||
        attribute.name.startsWith("data-find") ||
        attribute.name === "contenteditable"
      )
        element.removeAttribute(attribute.name);
  return clone.outerHTML;
}
