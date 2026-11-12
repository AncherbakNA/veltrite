import { useEffect, useRef, type RefObject } from "react";
import { insertIntoEditor } from "./editorInsertion";
import { api, type Tab, type useVault } from "./useVault";
interface Options {
  workspace: ReturnType<typeof useVault>;
  currentRef: RefObject<Tab | null>;
  onNotice: (text: string) => void;
  onSearch: (query: string) => void;
  onGraph: () => void;
  onDocument: () => void;
}
/** One subscription, fresh callbacks, and an acknowledgment after the requested UI operation. */
export function usePluginActions(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(
    () =>
      api().onPluginAction(async (action) => {
        const { workspace, currentRef, onNotice, onSearch, onGraph, onDocument } =
          latest.current;

        if (action.type === "notice") {
          onNotice(action.text);
          return;
        }
        if (action.type === "search") {
          onSearch(action.query);
          return;
        }
        if (action.type === "graph") {
          onGraph();
          return;
        }
        if (action.type === "rename" || action.type === "trash") {
          await workspace.flush();
          if (action.type === "rename") {
            await api().rename(action.path, action.to);
            await workspace.renameTab(action.path, action.to);
          } else {
            await api().trash(action.path);
            for (const tab of workspace.tabs.filter(
              (tab) => tab.path === action.path || tab.path.startsWith(action.path + "/"),
            ))
              await workspace.close(tab.path);
          }
          await workspace.refresh();
          return;
        }
        if (action.type === "open") {
          const pane = action.split
            ? workspace.splitPane(action.split)
            : workspace.activePane;
          if (!pane) throw Error("Не удалось создать панель");
          await workspace.open(action.path, pane);
          if (action.mode) workspace.setPaneMode(action.mode, pane);
          onDocument();
          await new Promise<void>((resolve, reject) => {
            const started = performance.now();
            const mounted = () => {
              if (
                currentRef.current?.path === action.path &&
                document.querySelector<HTMLElement>(".focused-pane")?.dataset.paneId ===
                  pane
              )
                resolve();
              else if (performance.now() - started > 4000)
                reject(Error("Панель не открылась"));
              else requestAnimationFrame(mounted);
            };
            mounted();
          });
          const draft = currentRef.current;
          await api().updatePluginContext({
            path: draft?.path || null,
            content: (draft?.content || "").slice(0, 1024 * 1024),
            selection: "",
            paneId: pane,
          });
          return;
        }

        const draft = currentRef.current;
        if (!draft || !/\.md$/i.test(draft.path)) {
          throw Error("Откройте текстовую заметку");
        }
        if (action.type === "append") {
          workspace.edit(draft.path, draft.content + action.text);
          return;
        }
        workspace.setPaneMode((previous) => (previous === "read" ? "live" : previous));
        await insertIntoEditor(draft.path, workspace.activePane, action.text);
      }),
    [],
  );
}
