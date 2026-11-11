import { renderToStaticMarkup } from "react-dom/server";
import { relativeLink } from "../shared/links";
import { resolveLink } from "../shared/markdown";
import type { FileEntry, NoteIndex } from "../shared/types";
import Markdown from "./components/Markdown";
import { api } from "./useVault";
import { VaultFilesContext } from "./VaultContext";
export async function buildStaticPages(index: NoteIndex[], files: FileEntry[]) {
  const paths = files.filter((f) => f.kind !== "folder").map((f) => f.path),
    pages = [];
  for (const note of index) {
    const data = await api().read(note.path),
      pagePath = "notes/" + note.path.replace(/\.md$/i, ".html");
    const html = renderToStaticMarkup(
      <VaultFilesContext.Provider value={paths}>
        <Markdown
          content={data.content}
          path={note.path}
          index={index}
          onLink={() => {}}
        />
      </VaultFilesContext.Provider>,
    );
    const dom = new DOMParser().parseFromString(html, "text/html");
    for (const anchor of dom.querySelectorAll("a[href]")) {
      const original = anchor.getAttribute("href")!;
      const target = original.startsWith("#vlt:")
        ? decodeURIComponent(original.slice(5))
        : original;
      if (/^https?:|^mailto:/i.test(target)) continue;
      const resolved = resolveLink(target, note.path, paths, index);
      if (!resolved) continue;
      const destination = resolved.toLowerCase().endsWith(".md")
        ? "notes/" + resolved.replace(/\.md$/i, ".html")
        : "files/" + resolved;
      anchor.setAttribute(
        "href",
        relativeLink(pagePath, destination) +
          (target.includes("#") ? "#" + encodeURIComponent(target.split("#")[1]) : ""),
      );
    }
    for (const element of dom.querySelectorAll("[src]")) {
      const source = element.getAttribute("src") || "";
      if (source.startsWith("veltrite-asset://vault/"))
        element.setAttribute(
          "src",
          relativeLink(
            pagePath,
            "files/" + decodeURIComponent(source.slice("veltrite-asset://vault/".length)),
          ),
        );
    }
    for (const embedded of dom.querySelectorAll(".embed-note")) {
      const button = embedded.querySelector("button");
      const resolved = button
        ? resolveLink(button.textContent || "", note.path, paths, index)
        : null;
      if (resolved) {
        const anchor = dom.createElement("a");
        anchor.href = relativeLink(
          pagePath,
          "notes/" + resolved.replace(/\.md$/i, ".html"),
        );
        anchor.textContent = button!.textContent;
        embedded.replaceChildren(anchor);
      }
    }
    pages.push({ path: pagePath, title: note.title, html: dom.body.innerHTML });
  }
  return pages;
}
