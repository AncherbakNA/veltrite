import type { Dispatch, SetStateAction } from "react";
import type { HistoryItem, NoteIndex, Preferences, VaultInfo } from "../shared/types";
import type { Command, DialogData } from "./components/Dialog";
import { api, type Tab, useVault } from "./useVault";
export type EditorMode = "live" | "source" | "read" | "split";
export interface PaletteState {
  commands: Command[];
  placeholder?: string;
}
type Setter<T> = Dispatch<SetStateAction<T>>;
interface CommandContext {
  bookmark: () => unknown;
  newFile: (kind: "note" | "canvas" | "base", initial?: string) => void;
  quickOpen: () => void;
  daily: () => unknown;
  setGraph: Setter<boolean>;
  setSection: Setter<string>;
  index: NoteIndex[];
  open: (path: string) => unknown;
  setSettings: Setter<boolean>;
  sync: () => unknown;
  run: (work: () => Promise<unknown>) => Promise<unknown>;
  workspace: ReturnType<typeof useVault>;
  importVault: () => unknown;
  chooseVault: (create?: boolean) => Promise<void>;
  vault: VaultInfo | null;
  preferences: Preferences | undefined;
  current: Tab | null;
  insert: (text: string) => void;
  recording: boolean;
  record: () => unknown;
  setHistory: Setter<HistoryItem[] | null>;
  setHistoryPreview: Setter<string>;
  setTrash: Setter<any[] | null>;
  setMode: Setter<EditorMode>;
  message: (text: string) => void;
  error: (text: string) => void;
  selection: string;
  setDialog: Setter<DialogData | null>;
  setPalette: Setter<PaletteState | null>;
  tabs: Tab[];
  active: string | null;
  setSlides: Setter<number | null>;
}
export function buildCommands(context: CommandContext): Command[] {
  const {
    bookmark,
    newFile,
    quickOpen,
    daily,
    setGraph,
    setSection,
    index,
    open,
    setSettings,
    sync,
    run,
    workspace,
    importVault,
    chooseVault,
    vault,
    preferences,
    current,
    insert,
    recording,
    record,
    setHistory,
    setHistoryPreview,
    setTrash,
    setMode,
    message,
    error,
    selection,
    setDialog,
    setPalette,
    tabs,
    active,
    setSlides,
  } = context;
  return [
    {
      id: "new-note",
      name: "Создать заметку",
      hint: "⌘/Ctrl N",
      run: () => newFile("note"),
    },
    { id: "new-canvas", name: "Создать холст", run: () => newFile("canvas") },
    {
      id: "new-base",
      name: "Создать базу заметок",
      run: () => newFile("base"),
    },
    {
      id: "new-folder",
      name: "Создать папку",
      run: () =>
        setDialog({
          title: "Новая папка",
          placeholder: "Название папки",
          onSubmit: async (name) => {
            await api().mkdir(name);
            await workspace.refresh();
          },
        }),
    },
    {
      id: "quick-open",
      name: "Перейти к файлу",
      hint: "⌘/Ctrl O",
      run: quickOpen,
    },
    { id: "daily", name: "Открыть ежедневную заметку", run: daily },
    {
      id: "unique",
      name: "Создать уникальную заметку",
      run: () =>
        newFile(
          "note",
          new Date()
            .toISOString()
            .replace(/[-:T.Z]/g, "")
            .slice(0, 14),
        ),
    },
    { id: "graph", name: "Открыть граф знаний", run: () => setGraph(true) },
    {
      id: "search",
      name: "Поиск по хранилищу",
      hint: "⌘/Ctrl ⇧ F",
      run: () => setSection("search"),
    },
    {
      id: "random",
      name: "Открыть случайную заметку",
      run: () => {
        if (index.length) open(index[Math.floor(Math.random() * index.length)].path);
      },
    },
    {
      id: "settings",
      name: "Настройки",
      hint: "⌘/Ctrl ,",
      run: () => setSettings(true),
    },
    {
      id: "sync",
      name: "Синхронизировать через GitHub",
      hint: "⌘/Ctrl ⇧ S",
      run: sync,
    },
    {
      id: "save",
      name: "Сохранить изменения",
      hint: "⌘/Ctrl S",
      run: () => run(() => workspace.flush()),
    },
    {
      id: "import",
      name: "Импортировать хранилище Obsidian",
      run: importVault,
    },
    {
      id: "open-vault",
      name: "Открыть другое хранилище",
      run: () => run(() => chooseVault()),
    },
    {
      id: "export-vault",
      name: "Экспортировать хранилище в папку",
      run: () =>
        run(async () => {
          await workspace.flush();
          if (await api().exportVault()) message("Хранилище экспортировано");
        }),
    },
    { id: "bookmark", name: "Добавить / убрать закладку", run: bookmark },
    {
      id: "reading",
      name: "Переключить чтение / редактирование",
      run: () => setMode((m) => (m === "read" ? "live" : "read")),
    },
    {
      id: "source",
      name: "Редактор: исходный код",
      run: () => setMode("source"),
    },
    {
      id: "split",
      name: "Редактор и предпросмотр рядом",
      run: () => setMode("split"),
    },
    {
      id: "template",
      name: "Вставить шаблон",
      run: () =>
        setPalette({
          placeholder: "Выберите шаблон…",
          commands: (
            vault?.files.filter(
              (f) =>
                f.kind === "note" &&
                f.path.startsWith(preferences!.templatesFolder + "/"),
            ) || []
          ).map((f) => ({
            id: f.path,
            name: f.name.replace(/\.md$/i, ""),
            run: () =>
              run(async () => {
                const data = await api().read(f.path);
                insert(
                  data.content
                    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString("sv-SE"))
                    .replace(/\{\{time\}\}/g, new Date().toLocaleTimeString("ru-RU"))
                    .replace(
                      /\{\{title\}\}/g,
                      current?.path.split("/").pop()?.replace(/\.md$/i, "") || "",
                    ),
                );
              }),
          })),
        }),
    },
    {
      id: "attachment",
      name: "Добавить вложение",
      run: () =>
        run(async () => {
          const paths = await api().importAttachments();
          if (current?.path.toLowerCase().endsWith(".md"))
            insert(paths.map((p) => `![[${p}]]`).join("\n") + "\n");
          await workspace.refresh();
        }),
    },
    {
      id: "record",
      name: recording ? "Остановить запись" : "Записать аудио",
      run: record,
    },
    {
      id: "history",
      name: "История версий заметки",
      run: () =>
        run(async () => {
          if (current) {
            await workspace.flush();
            setHistory(await api().history(current.path));
            setHistoryPreview("");
          }
        }),
    },
    {
      id: "trash",
      name: "Открыть корзину",
      run: () => run(async () => setTrash(await api().trashList())),
    },
    {
      id: "slides",
      name: "Показать заметку как слайды",
      run: () => {
        if (current) setSlides(0);
      },
    },
    {
      id: "pdf",
      name: "Экспортировать PDF",
      run: () =>
        run(async () => {
          setMode("read");
          await new Promise((r) => setTimeout(r, 250));
          if (await api().printPdf()) message("PDF сохранён");
        }),
    },
    {
      id: "html",
      name: "Экспортировать заметку в HTML",
      run: () =>
        run(async () => {
          if (!current) return;
          setMode("read");
          await new Promise((r) => setTimeout(r, 150));
          const html = document.querySelector(".reading-pane .markdown")?.outerHTML || "";
          if (
            await api().exportHtml(
              current.path,
              `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Заметка</title><style>body{max-width:800px;margin:60px auto;padding:24px;font:18px/1.7 system-ui;color:#25252b}img{max-width:100%}pre{background:#f2f2f5;padding:20px;overflow:auto}a{color:#6956b4}blockquote{border-left:3px solid #aaa;padding-left:20px}</style><body>${html}</body></html>`,
            )
          )
            message("HTML сохранён");
        }),
    },
    {
      id: "extract",
      name: "Создать заметку из выделенного текста",
      run: () => {
        if (!selection) {
          error("Сначала выделите текст в редакторе");
          return;
        }
        const text = selection;
        setDialog({
          title: "Заметка из выделения",
          placeholder: "Название",
          onSubmit: async (name) => {
            const path = name.replace(/\.md$/i, "") + ".md";
            await api().create(path, text);
            await workspace.refresh();
            await open(path);
          },
        });
      },
    },
    {
      id: "compose",
      name: "Объединить с другой заметкой",
      run: () => {
        if (!current?.path.toLowerCase().endsWith(".md")) return;
        setPalette({
          placeholder: "Перенести содержимое в…",
          commands: index
            .filter((n) => n.path !== current.path)
            .map((n) => ({
              id: n.path,
              name: n.title,
              run: () =>
                run(async () => {
                  await workspace.flush();
                  const other = await api().read(n.path);
                  await api().write(
                    n.path,
                    other.content + "\n\n---\n\n" + current.content,
                    other.revision,
                  );
                  const own = await api().read(current.path);
                  await api().write(
                    current.path,
                    `# Перенесено\n\nСодержимое перенесено в [[${n.path.replace(/\.md$/i, "")}]].\n`,
                    own.revision,
                  );
                  await workspace.refresh();
                  await open(n.path);
                }),
            })),
        });
      },
    },
    {
      id: "publish",
      name: "Опубликовать базу знаний: экспорт сайта",
      run: () =>
        run(async () => {
          await workspace.flush();
          const { buildStaticPages } = await import("./publish");
          const pages = await buildStaticPages(index, vault!.files);
          const count = await api().publishSite(pages);
          if (count !== null)
            message(
              `Сайт готов: ${count} страниц. Его можно разместить на GitHub Pages или своём хостинге.`,
            );
        }),
    },
    {
      id: "web-viewer",
      name: "Открыть веб-просмотр",
      run: () =>
        setDialog({
          title: "Открыть сайт",
          placeholder: "https://…",
          confirm: "Открыть",
          onSubmit: (url) => api().webViewer(url),
        }),
    },
    {
      id: "workspace-save",
      name: "Сохранить рабочее пространство",
      run: () =>
        setDialog({
          title: "Сохранить рабочее пространство",
          placeholder: "Название",
          confirm: "Сохранить",
          onSubmit: async (name) => {
            await api().workspaceSave(name, {
              tabs: tabs.map((t) => t.path),
              active,
            });
            message("Рабочее пространство сохранено");
          },
        }),
    },
    {
      id: "workspace-open",
      name: "Открыть рабочее пространство",
      run: () =>
        run(async () =>
          setPalette({
            placeholder: "Рабочие пространства…",
            commands: (await api().workspaces()).map((w) => ({
              id: w.name,
              name: w.name,
              run: () =>
                run(async () => {
                  await workspace.flush();
                  for (const path of w.tabs)
                    if (vault?.files.some((f) => f.path === path))
                      await workspace.open(path);
                  if (w.active) await open(w.active);
                }),
            })),
          }),
        ),
    },
    {
      id: "reveal",
      name: "Показать папку хранилища",
      run: () => run(() => api().reveal()),
    },
  ];
}
