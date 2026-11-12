import { lazy, type Dispatch, type SetStateAction } from "react";
import type { DocumentLeaf } from "../../shared/panes";
import { leaves } from "../../shared/panes";
import type { NoteIndex, Preferences, VaultInfo } from "../../shared/types";
import { api, type Tab, type useVault } from "../useVault";
import { type Command, type DialogData } from "./Dialog";
import DocumentBoundary from "./DocumentBoundary";
import DocumentToolbar from "./DocumentToolbar";
import Markdown from "./Markdown";
const Editor = lazy(() => import("./Editor"));
const Canvas = lazy(() => import("./Canvas"));
const Bases = lazy(() => import("./Bases"));
interface Props {
  current: Tab;
  pane: DocumentLeaf;
  workspace: Pick<
    ReturnType<typeof useVault>,
    "layout" | "edit" | "discard" | "setPaneMode" | "splitPane" | "closePane"
  >;
  index: NoteIndex[];
  preferences: Preferences;
  vault: VaultInfo;
  open: (path: string, paneId?: string) => unknown;
  openLink: (target: string, from: string, paneId: string) => void;
  bookmark: (path: string) => unknown;
  commands: Command[];
  setDialog: Dispatch<SetStateAction<DialogData | null>>;
  setPalette: Dispatch<
    SetStateAction<{
      commands: Command[];
      placeholder?: string;
      scope?: "commands";
      onPick?: () => void;
    } | null>
  >;
  setSelection: (text: string) => void;
  canGoBack: boolean;
  onBack: () => void;
}
export default function DocumentPane({
  current,
  pane,
  workspace,
  index,
  preferences,
  vault,
  open,
  openLink,
  bookmark,
  commands,
  setDialog,
  setPalette,
  setSelection,
  canGoBack,
  onBack,
}: Props) {
  const mode = pane.mode;
  return (
    <DocumentBoundary
      key={current.path + mode}
      onSource={() => workspace.setPaneMode("source", pane.id)}
    >
      <>
        <DocumentToolbar
          path={current.path}
          mode={mode}
          setMode={(next) => workspace.setPaneMode(next, pane.id)}
          onSplit={(direction) => workspace.splitPane(direction, pane.id)}
          onClosePane={
            leaves(workspace.layout).length > 1
              ? () => workspace.closePane(pane.id)
              : undefined
          }
          canGoBack={canGoBack}
          onBack={onBack}
          bookmarked={preferences!.bookmarks.includes(current.path)}
          onBookmark={() => bookmark(current.path)}
          onActions={() =>
            setPalette({
              commands: commands.filter((command) =>
                [
                  "source",
                  "pane-right",
                  "pane-below",
                  "pane-close",
                  "split",
                  "reading",
                  "history",
                  "html",
                  "pdf",
                  "slides",
                  "compose",
                  "extract",
                  "attachment",
                  "template",
                  "bookmark",
                  "reveal",
                ].includes(command.id),
              ),
            })
          }
        />
        {current.error && (
          <div className="save-error">
            <span>{current.error}</span>
            <button
              onClick={() => {
                const draft = current.content;
                setDialog({
                  title: "Сохранить вашу правку отдельной заметкой",
                  initial: current.path.replace(/\.[^.]+$/, "") + " (моя правка)",
                  onSubmit: async (name) => {
                    const path = name + ".md";
                    await api().create(path, draft);
                    await open(path);
                  },
                });
              }}
            >
              Сохранить копию
            </button>
            <button
              onClick={() =>
                setDialog({
                  title: "Закрыть несохранённый черновик?",
                  description:
                    "Текст в этой вкладке будет закрыт. Сначала сохраните копию, если он нужен. Файл на диске останется без изменений.",
                  input: false,
                  danger: true,
                  confirm: "Закрыть черновик",
                  onSubmit: () => workspace.discard(current.path),
                })
              }
            >
              Закрыть черновик
            </button>
          </div>
        )}
        {current.path.toLowerCase().endsWith(".canvas") && mode !== "source" ? (
          <Canvas
            key={current.path}
            content={current.content}
            onChange={(text) => workspace.edit(current.path, text)}
            index={index}
            onOpen={(path) => open(path, pane.id)}
            onChooseFile={(add) =>
              setPalette({
                placeholder: "Выберите файл для холста…",
                commands: vault.files
                  .filter((f) => f.kind !== "folder" && f.path !== current.path)
                  .map((f) => ({
                    id: f.path,
                    name: f.path,
                    run: () => add(f.path),
                  })),
              })
            }
            onChooseLink={(add) =>
              setDialog({
                title: "Ссылка на холсте",
                placeholder: "https://…",
                confirm: "Добавить",
                onSubmit: (value) => {
                  if (!/^https?:\/\//i.test(value))
                    throw Error("Введите ссылку HTTP или HTTPS");
                  add(value);
                },
              })
            }
          />
        ) : current.path.toLowerCase().endsWith(".base") && mode !== "source" ? (
          <Bases
            content={current.content}
            index={index}
            files={vault.files}
            onOpen={(path) => open(path, pane.id)}
            onChange={(text) => workspace.edit(current.path, text)}
          />
        ) : (
          <div
            className={
              "document-content mode-" +
              mode +
              (preferences!.readableLineLength ? " readable" : "")
            }
          >
            {mode !== "read" && (
              <div className="writing-pane">
                <Editor
                  key={current.path}
                  content={current.content}
                  path={current.path}
                  paneId={pane.id}
                  index={index}
                  onChange={(text) => workspace.edit(current.path, text)}
                  preferences={preferences!}
                  onLink={(target) => openLink(target, current.path, pane.id)}
                  onCommand={(onPick) =>
                    setPalette({ commands: [], scope: "commands", onPick })
                  }
                  onSelection={setSelection}
                  live={mode !== "source"}
                />
              </div>
            )}
            {(mode === "read" || mode === "split") && (
              <div className="reading-pane">
                <Markdown
                  content={current.content}
                  path={current.path}
                  index={index}
                  onLink={(target) => openLink(target, current.path, pane.id)}
                />
              </div>
            )}
          </div>
        )}
      </>
    </DocumentBoundary>
  );
}
