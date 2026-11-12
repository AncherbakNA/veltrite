import { createRoot } from "react-dom/client";
import type { FileEntry, NoteIndex, Preferences } from "../shared/types";
import Markdown from "./components/Markdown";
import { exportDocument } from "./exportDocument";
import { api } from "./useVault";
import { VaultFilesContext, VaultRuntimeContext } from "./VaultContext";
/** Effects/workers finish in an off-screen document; exported output matches the reader. */
export async function buildStaticPages(
  index: NoteIndex[],
  files: FileEntry[],
  preferences?: Preferences,
) {
  const paths = files.filter((file) => file.kind !== "folder").map((file) => file.path),
    pages = [];
  const container = document.createElement("div");
  container.inert = true;
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "900px",
    height: "auto",
    pointerEvents: "none",
  });
  document.body.append(container);
  const root = createRoot(container);
  try {
    for (const note of index) {
      const data = await api().read(note.path);
      root.render(
        <VaultFilesContext.Provider value={paths}>
          <VaultRuntimeContext.Provider
            value={{ files, types: preferences?.propertyTypes || {} }}
          >
            <Markdown
              key={note.path}
              content={data.content}
              path={note.path}
              index={index}
              onLink={() => {}}
            />
          </VaultRuntimeContext.Provider>
        </VaultFilesContext.Provider>,
      );
      const started = performance.now();
      let stable = 0;
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          if (
            container.querySelector<HTMLElement>(".markdown")?.dataset.markdownPath ===
              note.path &&
            !container.querySelector("[data-render-pending]")
          )
            stable++;
          else stable = 0;
          if (stable >= 3) resolve();
          else if (performance.now() - started > 15000)
            reject(Error("Не удалось подготовить страницу для экспорта: " + note.path));
          else requestAnimationFrame(ready);
        };
        ready();
      });
      await Promise.race([
        Promise.all(
          [...container.querySelectorAll("img")].map((image) => {
            image.loading = "eager";
            return image.decode().catch(() => {});
          }),
        ),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      pages.push({
        path: "notes/" + note.path.replace(/\.md$/i, ".html"),
        title: note.title,
        html: exportDocument(
          container.querySelector<HTMLElement>(".markdown")!,
          note.path,
          paths,
          index,
          true,
        ),
      });
    }
    return pages;
  } finally {
    root.unmount();
    container.remove();
  }
}
