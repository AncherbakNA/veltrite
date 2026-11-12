import type { Dispatch, SetStateAction } from "react";
import { plural } from "../shared/format";
import { renderTemplate } from "../shared/templates";
import type { HistoryItem, NoteIndex, Preferences, VaultInfo } from "../shared/types";
import type { Command, DialogData } from "./components/Dialog";
import { exportDocument } from "./exportDocument";
import { readingForExport } from "./navigation";
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
  unique: () => unknown;
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
  compose: (operation: "extract" | "merge") => void;
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
    unique,
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
    compose,
    setDialog,
    setPalette,
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
    { id: "unique", name: "Создать уникальную заметку", run: unique },
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
      name: "Импортировать папку",
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
      id: "pane-right",
      name: "Разделить панель вправо",
      run: () => workspace.splitPane("row"),
    },
    {
      id: "pane-below",
      name: "Разделить панель вниз",
      run: () => workspace.splitPane("column"),
    },
    {
      id: "pane-close",
      name: "Закрыть текущую панель",
      run: () => workspace.closePane(workspace.activePane),
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
                (!preferences!.templatesFolder ||
                  f.path.startsWith(preferences!.templatesFolder + "/")),
            ) || []
          ).map((f) => ({
            id: f.path,
            name: f.name.replace(/\.md$/i, ""),
            run: () =>
              run(async () => {
                const data = await api().read(f.path);
                insert(
                  renderTemplate(data.content, {
                    title: current?.path.split("/").pop()?.replace(/\.md$/i, "") || "",
                    dateFormat: preferences?.templateDateFormat,
                    timeFormat: preferences?.templateTimeFormat,
                  }),
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
          if (!current) return;
          await workspace.flush();
          setMode("read");
          await readingForExport(current.path, workspace.activePane);
          if (await api().printPdf()) message("PDF сохранён");
        }),
    },
    {
      id: "html",
      name: "Экспортировать заметку в HTML",
      run: () =>
        run(async () => {
          if (!current) return;
          await workspace.flush();
          setMode("read");
          const root = await readingForExport(current.path, workspace.activePane);
          const html = exportDocument(
            root,
            current.path,
            vault!.files
              .filter((file) => file.kind !== "folder")
              .map((file) => file.path),
            index,
          );
          if (
            await api().exportHtml(
              current.path,
              `<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; object-src 'none'; base-uri 'none'"><title>${current.path.replace(/[&<>"']/g, (character) => "&#" + character.charCodeAt(0) + ";")}</title><!--veltrite-styles--><style>body{max-width:850px;margin:40px auto;padding:24px;overflow:auto;font:16px/1.7 system-ui;background:#fbfaf7;color:#24221f}.markdown{max-width:none}.markdown img,.markdown video{max-width:100%;height:auto}.markdown [hidden]{display:block}pre{white-space:pre-wrap}.embed-content{overflow:visible}figure{margin:12px 0}a{color:#806342}</style></head><body>${html}</body></html>`,
            )
          )
            message("HTML сохранён");
        }),
    },
    {
      id: "extract",
      name: "Создать заметку из выделенного текста",
      run: () => compose("extract"),
    },
    { id: "compose", name: "Объединить с другой заметкой", run: () => compose("merge") },
    {
      id: "publish",
      name: "Опубликовать базу знаний: экспорт сайта",
      run: () =>
        run(async () => {
          await workspace.flush();
          const { buildStaticPages } = await import("./publish");
          const pages = await buildStaticPages(index, vault!.files, preferences);
          const count = await api().publishSite(pages);
          if (count !== null)
            message(
              `Сайт готов: ${plural(count, ["страница", "страницы", "страниц"])}. Его можно разместить на GitHub Pages или своём хостинге.`,
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
      name: "Сохранить набор вкладок",
      run: () =>
        setDialog({
          title: "Сохранить набор вкладок",
          placeholder: "Название",
          confirm: "Сохранить",
          onSubmit: async (name) => {
            await api().workspaceSave(name, workspace.sessionData());
            message("Набор вкладок сохранён");
          },
        }),
    },
    {
      id: "workspace-open",
      name: "Открыть набор вкладок",
      run: () =>
        run(async () =>
          setPalette({
            placeholder: "Наборы вкладок…",
            commands: (await api().workspaces()).map((w) => ({
              id: w.name,
              name: w.name,
              run: () =>
                run(async () => {
                  await workspace.flush();
                  for (const path of w.tabs)
                    if (vault?.files.some((f) => f.path === path))
                      await workspace.open(path);
                  workspace.restoreLayout(
                    w,
                    w.tabs.filter((path) => vault?.files.some((f) => f.path === path)),
                  );
                  if (w.active) await open(w.active);
                }),
            })),
          }),
        ),
    },
    ...(["rename", "delete"] as const).map((operation) => ({
      id: "workspace-" + operation,
      name:
        operation === "rename" ? "Переименовать набор вкладок" : "Удалить набор вкладок",
      run: () =>
        void run(async () =>
          setPalette({
            placeholder: "Выберите набор вкладок…",
            commands: (await api().workspaces()).map((entry) => ({
              id: entry.name,
              name: entry.name,
              run: () =>
                setDialog({
                  title:
                    operation === "rename"
                      ? "Переименовать набор вкладок"
                      : "Удалить набор вкладок?",
                  initial: entry.name,
                  input: operation === "rename",
                  danger: operation === "delete",
                  confirm: operation === "rename" ? "Сохранить" : "Удалить",
                  description:
                    operation === "delete"
                      ? entry.name + ". Заметки останутся в хранилище."
                      : undefined,
                  onSubmit: async (name) => {
                    if (operation === "rename")
                      await api().workspaceRename(entry.name, name);
                    else await api().workspaceDelete(entry.name);
                  },
                }),
            })),
          }),
        ),
    })),
    {
      id: "reveal",
      name: "Показать папку хранилища",
      run: () => run(() => api().reveal()),
    },
  ];
}
