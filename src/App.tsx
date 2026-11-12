import { Check, Clock3, FolderOpen, GitBranch, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parse as yamlParse } from "yaml";
import { legacyBookmarks, type Bookmark } from "../shared/bookmarks";
import { editorActions } from "../shared/editor-actions";
import { plural } from "../shared/format";
import { editFrontmatter } from "../shared/frontmatter-edit";
import { linkResolver } from "../shared/graph";
import { effectiveHotkeys, eventShortcut, shortcutLabel } from "../shared/hotkeys";
import { folderFile } from "../shared/links";
import { indexNote, resolveLink } from "../shared/markdown";
import {
  decodeFragment,
  findHeading,
  noteHeadings,
  referenceBlocks,
} from "../shared/markdown-blocks";
import { leaves } from "../shared/panes";
import { parseProperty, type PropertyType } from "../shared/properties";
import { formatDate, renderTemplate } from "../shared/templates";
import {
  accentButtonText,
  accentForTheme,
  readableAccent,
  themeTokens,
} from "../shared/themes";
import type { HistoryItem, PluginInfo, Preferences } from "../shared/types";
import { VaultFilesContext, VaultRuntimeContext } from "./VaultContext";
import { buildCommands } from "./commands";
import BrandMark from "./components/BrandMark";
import {
  CommandPalette,
  Dialog,
  type Command,
  type DialogData,
} from "./components/Dialog";
import DocumentBoundary from "./components/DocumentBoundary";
import DocumentPane from "./components/DocumentPane";
import FileCollection from "./components/FileCollection";
import Inspector from "./components/Inspector";
import NoteComposer, { type ComposerState } from "./components/NoteComposer";
import PaneTree from "./components/PaneTree";
import { PluginButtons, PluginStatus } from "./components/PluginButtons";
import PropertiesManager from "./components/PropertiesManager";
import Sidebar, { type FileFilter } from "./components/Sidebar";
import Slides from "./components/Slides";
import Welcome from "./components/Welcome";
import WindowTabs from "./components/WindowTabs";
import WorkspaceHome from "./components/WorkspaceHome";
import { editorSnapshot, insertIntoEditor, runEditorAction } from "./editorInsertion";
import { navigateToNote } from "./navigation";
import { isMac } from "./ui";
import { usePluginActions } from "./usePluginActions";
import { useStyles } from "./useStyles";
import { api, useVault } from "./useVault";
const Graph = lazy(() => import("./components/Graph"));
const Settings = lazy(() => import("./components/Settings"));
export default function App() {
  const [toast, setToast] = useState<{
      message: string;
      error: boolean;
    } | null>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const message = useCallback((text: string, error = false) => {
    setToast({ message: text, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 12000 : 5000);
  }, []);
  const error = useCallback((text: string) => message(text, true), [message]);
  const [updating, setUpdating] = useState(false),
    updatingRef = useRef(false);
  updatingRef.current = updating;
  useEffect(
    () =>
      api().onUpdateState((state) => {
        if (state.phase === "error") setUpdating(false);
      }),
    [],
  );
  const workspace = useVault(error);
  const { state, tabs, active, current, index, mode } = workspace;
  const setMode = workspace.setPaneMode;
  const vault = state?.vault || null,
    preferences = vault?.preferences;
  const hotkeysRef = useRef(preferences?.hotkeys || {});
  hotkeysRef.current = preferences?.hotkeys || {};
  const currentRef = useRef(current);
  currentRef.current = current;
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [requestedSearch, setRequestedSearch] = useState<{
    query: string;
    id: number;
  } | null>(null);
  const [graphBookmark, setGraphBookmark] = useState<{
    query: string;
    local?: string;
    id: number;
  } | null>(null);
  const [section, setSection] = useState("files"),
    [graph, setGraph] = useState(false),
    [home, setHome] = useState(false),
    [fileFilter, setFileFilter] = useState<FileFilter>("all"),
    [collection, setCollection] = useState<FileFilter | null>(null),
    [right, setRight] = useState(window.innerWidth >= 1180),
    [settings, setSettings] = useState(false),
    [settingsTab, setSettingsTab] = useState("appearance"),
    [palette, setPalette] = useState<{
      commands: Command[];
      placeholder?: string;
      scope?: "commands";
      onPick?: () => void;
    } | null>(null),
    [dialog, setDialog] = useState<DialogData | null>(null),
    [selection, setSelection] = useState(""),
    [history, setHistory] = useState<HistoryItem[] | null>(null),
    [historyPreview, setHistoryPreview] = useState(""),
    [trash, setTrash] = useState<any[] | null>(null),
    [slides, setSlides] = useState<number | null>(null),
    [recording, setRecording] = useState(false),
    [syncing, setSyncing] = useState(false),
    [recentOpen, setRecentOpen] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    chunks = useRef<Blob[]>([]),
    audioSave = useRef<Promise<unknown> | null>(null),
    openHistory = useRef<string[]>([]),
    historyPosition = useRef(-1),
    actionRef = useRef<(a: string) => void>(() => {});
  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      try {
        return await work();
      } catch (e: any) {
        error(e.message || "Не удалось выполнить действие");
      }
    },
    [error],
  );
  useEffect(() => {
    if (!preferences) return;
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark =
        preferences.theme === "dark" ||
        (preferences.theme === "system" && system.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.body.classList.toggle("theme-dark", dark);
      document.body.classList.toggle("theme-light", !dark);
      const colors = preferences.customTheme?.variants[dark ? "dark" : "light"];
      for (const token of themeTokens) {
        if (colors)
          document.documentElement.style.setProperty("--" + token, colors[token]);
        else document.documentElement.style.removeProperty("--" + token);
      }
      const accent = accentForTheme(preferences.accent, dark);
      document.documentElement.style.setProperty("--accent", accent);
      const computed = getComputedStyle(document.documentElement);
      const palette =
        colors ||
        (Object.fromEntries(
          themeTokens.map((token) => [
            token,
            computed.getPropertyValue("--" + token).trim(),
          ]),
        ) as import("../shared/themes").ThemeColors);
      document.documentElement.style.setProperty(
        "--accent-ink",
        readableAccent(accent, palette),
      );
      document.documentElement.style.setProperty(
        "--accent-button-text",
        accentButtonText(accent),
      );
    };
    applyTheme();
    system.addEventListener("change", applyTheme);
    document.documentElement.style.setProperty(
      "--editor-size",
      preferences.fontSize + "px",
    );
    document.documentElement.dataset.textFont = preferences.textFont;
    return () => system.removeEventListener("change", applyTheme);
  }, [preferences]);
  useStyles(preferences, vault?.root);
  useEffect(() => api().onMenu((action) => actionRef.current(action)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (updatingRef.current) {
        e.preventDefault();
        return;
      }
      if ((e.target as Element | null)?.closest?.("[data-hotkey-recording]")) return;
      if (e.key === "Escape") {
        setPalette(null);
        setDialog(null);
        setSettings(false);
        setHistory(null);
        setTrash(null);
        setSlides(null);
        setComposer(null);
        setPropertiesOpen(false);
        return;
      }
      if ((e.target as Element | null)?.closest?.("[data-hotkey-recording]")) return;
      if (document.querySelector('[role="dialog"]')) return;
      const shortcut = eventShortcut(e, isMac);
      if (!shortcut) return;
      const command = Object.entries(effectiveHotkeys(hotkeysRef.current)).find(
        ([, values]) => values.includes(shortcut),
      )?.[0];
      if (command) {
        e.preventDefault();
        e.stopPropagation();
        actionRef.current(command);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const open = useCallback(
    (path: string, paneId?: string) =>
      run(async () => {
        await workspace.open(path, paneId);
        setGraph(false);
        setHome(false);
        setCollection(null);
        if (openHistory.current[historyPosition.current] !== path) {
          openHistory.current = openHistory.current.slice(0, historyPosition.current + 1);
          openHistory.current.push(path);
          historyPosition.current = openHistory.current.length - 1;
        }
      }),
    [workspace.open, vault, run],
  );
  const updatePreferences = useCallback(
    (next: Preferences) =>
      workspace.setState((s) =>
        s?.vault ? { ...s, vault: { ...s.vault, preferences: next } } : s,
      ),
    [workspace.setState],
  );
  const insert = (text: string) => {
    const draft = currentRef.current;
    if (!draft) {
      error("Откройте заметку");
      return;
    }
    setMode((mode) => (mode === "read" ? "live" : mode));
    void run(() => insertIntoEditor(draft.path, workspace.activePane, text));
  };
  usePluginActions({
    workspace,
    currentRef,
    onNotice: message,
    onSearch: (query) => {
      setSection("search");
      setRequestedSearch({ query, id: Date.now() });
    },
    onGraph: () => {
      setHome(false);
      setCollection(null);
      setGraph(true);
    },
    onDocument: () => {
      setHome(false);
      setCollection(null);
      setGraph(false);
    },
  });
  useEffect(() => {
    setSelection("");
  }, [active, workspace.activePane]);
  useEffect(() => {
    void api()
      .updatePluginContext({
        path: current?.path || null,
        content: (current?.content || "").slice(0, 1024 * 1024),
        selection: selection.slice(0, 1024 * 1024),
        paneId: workspace.activePane,
      })
      .catch(() => {});
  }, [current?.path, current?.content, selection, workspace.activePane]);
  const newFile = (kind: "note" | "canvas" | "base", initial?: string) => {
    const extension = kind === "canvas" ? ".canvas" : kind === "base" ? ".base" : ".md";
    setDialog({
      title:
        kind === "canvas"
          ? "Новый холст"
          : kind === "base"
            ? "Новая база"
            : "Новая заметка",
      placeholder: "Папка/Название",
      initial,
      confirm: "Создать",
      onSubmit: async (name) => {
        const path = name.endsWith(extension) ? name : name + extension;
        const text =
          kind === "canvas"
            ? '{"nodes":[],"edges":[]}'
            : kind === "base"
              ? "views:\n  - type: table\n    name: Все заметки\n    order:\n      - file.name\n      - tags\n"
              : `# ${name.split("/").pop()?.replace(/\.md$/i, "")}\n\n`;
        await api().create(path, text);
        await workspace.refresh();
        await open(path);
      },
    });
  };
  const openLink = (
    target: string,
    from = current?.path || "",
    paneId = workspace.activePane,
  ) => {
    const paths =
      vault?.files.filter((f) => f.kind !== "folder").map((f) => f.path) || [];
    const resolved = resolveLink(target, from, paths, index);
    if (resolved)
      run(async () => {
        await open(resolved, paneId);
        const subpath = decodeFragment(target);
        if (!subpath) return;
        if (/\.pdf$/i.test(resolved)) {
          const number = Number(new URLSearchParams(subpath).get("page")) || 1;
          const started = performance.now();
          await new Promise<void>((resolve, reject) => {
            const navigate = () => {
              const viewer = [
                ...document.querySelectorAll<HTMLElement>(".document-leaf > .pdf-viewer"),
              ].find(
                (element) =>
                  element.dataset.pdfPath === resolved &&
                  element.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ===
                    paneId,
              );
              if (viewer?.dataset.pdfReady === "true") {
                window.dispatchEvent(
                  new CustomEvent("veltrite:pdf-page", {
                    detail: { path: resolved, paneId, page: number },
                  }),
                );
                resolve();
              } else if (performance.now() - started > 8000)
                reject(Error("Не удалось открыть страницу PDF"));
              else requestAnimationFrame(navigate);
            };
            navigate();
          });
          return;
        }
        if (!/\.md$/i.test(resolved)) return;
        const tab = tabs.find((t) => t.path === resolved),
          text = tab?.content || (await api().read(resolved)).content;
        const heading = findHeading(noteHeadings(text), subpath);
        const block = subpath.startsWith("^")
          ? referenceBlocks(text).find((item) => item.id === subpath.slice(1))
          : null;
        const destinationPane = paneId || workspace.activePane;
        const destinationMode =
          leaves(workspace.layout).find((pane) => pane.id === destinationPane)?.mode ||
          mode;
        await navigateToNote(
          resolved,
          destinationPane,
          destinationMode,
          subpath.startsWith("^") ? "block-" + subpath.slice(1) : heading?.id || "",
          heading?.line || block?.line,
        );
      });
    else newFile("note", target.split("#")[0]);
  };
  const sync = () =>
    run(async () => {
      if (!state?.sync.configured) {
        setSettingsTab("sync");
        setSettings(true);
        return;
      }
      await workspace.flush();
      setSyncing(true);
      try {
        const result = await api().syncNow();
        workspace.updateSync(await api().syncStatus());
        await workspace.refresh();
        message(
          `Синхронизировано. Отправлено: ${result.uploaded}, получено: ${result.downloaded}${result.conflicts.length ? ". Конфликтующие версии сохранены отдельными файлами: " + result.conflicts.join(", ") : ""}`,
        );
      } finally {
        setSyncing(false);
      }
    });
  const flushForVaultChange = async () => {
    if (recording || audioSave.current)
      throw Error("Завершите запись и дождитесь сохранения аудио перед сменой хранилища");
    await workspace.flush();
  };
  const chooseVault = async (create = false) => {
    await flushForVaultChange();
    setSettings(false);
    const selected = await api().chooseVault(create);
    if (selected) {
      await workspace.switchVault(selected);
      setGraph(false);
      setRecentOpen(false);
      const welcome = selected.files.find((f) => f.kind === "note");
      if (welcome) await open(welcome.path);
    }
  };
  const importVault = () =>
    run(async () => {
      await flushForVaultChange();
      setSettings(false);
      const result = await api().importFolder();
      if (result) {
        await workspace.switchVault(result.vault);
        setDialog({
          title: "Импорт завершён",
          input: false,
          description: `Скопировано файлов: ${result.imported}. ${result.skipped.length ? "Пропущено: " + result.skipped.join(", ") + ". " : ""}${result.warnings.join(" ")}`,
          confirm: "Понятно",
          onSubmit: () => {},
        });
      }
    });
  const quickOpen = () =>
    setPalette({
      placeholder: "Перейти к файлу…",
      commands: (vault?.files.filter((f) => f.kind !== "folder") || []).map((f) => ({
        id: f.path,
        name: f.path.replace(/\.(md|canvas|base)$/i, ""),
        group:
          f.kind === "canvas"
            ? "Холст"
            : f.kind === "base"
              ? "База"
              : f.kind === "attachment"
                ? "Вложение"
                : "Заметка",
        run: () => open(f.path),
      })),
    });
  const daily = () =>
    run(async () => {
      const now = new Date(),
        date = formatDate(now, "YYYY-MM-DD"),
        title = formatDate(now, preferences!.dailyFormat),
        path = folderFile(preferences!.dailyFolder, title + ".md");
      if (!vault?.files.some((f) => f.path === path)) {
        const template = preferences!.dailyTemplate
          ? (await api().read(preferences!.dailyTemplate)).content
          : `---\ndate: ${date}\ntags: [дневник]\n---\n# ${now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}\n\n`;
        await api().create(
          path,
          renderTemplate(template, {
            title: title.split("/").pop()!,
            date: now,
            dateFormat: preferences!.templateDateFormat,
            timeFormat: preferences!.templateTimeFormat,
          }),
        );
      }
      await workspace.refresh();
      await open(path);
    });
  const unique = () =>
    run(async () => {
      if (!preferences) return;
      const now = new Date(),
        title = formatDate(now, preferences.uniqueFormat);
      let path = title + ".md",
        suffix = 2;
      while (vault?.files.some((file) => file.path === path))
        path = title + "-" + suffix++ + ".md";
      const template = preferences.uniqueTemplate
        ? (await api().read(preferences.uniqueTemplate)).content
        : "";
      await api().create(
        path,
        renderTemplate(template, {
          title: path.split("/").pop()!.replace(/\.md$/i, ""),
          date: now,
          dateFormat: preferences.templateDateFormat,
          timeFormat: preferences.templateTimeFormat,
        }),
      );
      await workspace.refresh();
      await open(path);
    });
  const bookmark = (path = current?.path) =>
    run(async () => {
      if (!path || !preferences) return;
      const list = preferences.bookmarks.includes(path)
        ? preferences.bookmarks.filter((p) => p !== path)
        : [...preferences.bookmarks, path];
      updatePreferences(await api().preferences({ bookmarks: list }));
    });
  const saveBookmarks = (bookmarkItems: Bookmark[]) =>
    run(async () => {
      if (preferences)
        updatePreferences({
          ...preferences,
          bookmarkItems,
          bookmarks: legacyBookmarks(bookmarkItems),
        });
      updatePreferences(await api().preferences({ bookmarkItems }));
    });
  const addBookmark = (item: Bookmark) => {
    if (!preferences) return;
    void saveBookmarks([...preferences.bookmarkItems, item]);
    setSection("bookmarks");
  };
  const saveSearch = (query: string) =>
    setDialog({
      title: "Сохранить поисковый запрос",
      initial: query,
      placeholder: "tag:проект path:Работа",
      confirm: "Сохранить",
      onSubmit: (query) => {
        addBookmark({ id: crypto.randomUUID(), title: "", type: "search", query });
      },
    });
  const openBookmark = (item: Bookmark) => {
    if (item.type === "file")
      openLink(item.path + (item.fragment ? "#" + item.fragment : ""));
    if (item.type === "search") {
      setRequestedSearch({ query: item.query, id: Date.now() });
      setSection("search");
    }
    if (item.type === "folder") {
      setRequestedSearch({
        query: 'path:"' + item.path.replaceAll('"', '\\"') + '/"',
        id: Date.now(),
      });
      setSection("search");
    }
    if (item.type === "url") void run(() => api().openExternal(item.url));
    if (item.type === "graph") {
      setHome(false);
      setCollection(null);
      setGraphBookmark({ query: item.query, local: item.local, id: Date.now() });
      setGraph(true);
    }
  };
  const record = () =>
    run(async () => {
      if (audioSave.current) throw Error("Дождитесь сохранения записи");
      if (recorder.current?.state === "recording") {
        recorder.current.stop();
        return;
      }
      if (!current?.path.toLowerCase().endsWith(".md"))
        throw Error("Откройте заметку для записи звука");
      const recordingPath = current.path;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new MediaRecorder(stream);
      recorder.current = audio;
      chunks.current = [];
      audio.ondataavailable = (e) => chunks.current.push(e.data);
      audio.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const pending = run(async () => {
          const data = new Uint8Array(
              await new Blob(chunks.current, {
                type: "audio/webm",
              }).arrayBuffer(),
            ),
            file = await api().saveAudio([...data]);
          await workspace.flush();
          const note = await api().read(recordingPath);
          await api().write(
            recordingPath,
            note.content + `\n![[${file}]]\n`,
            note.revision,
          );
          await workspace.refresh();
        });
        audioSave.current = pending;
        void pending.finally(() => {
          if (audioSave.current === pending) {
            audioSave.current = null;
            setRecording(false);
          }
        });
      };
      audio.start();
      setRecording(true);
    });
  const fileAction = (action: string, path: string) => {
    if (action === "bookmark") {
      addBookmark({
        id: crypto.randomUUID(),
        title: "",
        type:
          vault?.files.find((file) => file.path === path)?.kind === "folder"
            ? "folder"
            : "file",
        path,
      });
      return;
    }
    if (action === "reveal") {
      run(() => api().reveal(path));
      return;
    }
    if (action === "rename")
      setDialog({
        title: "Переименовать или переместить",
        description:
          "Укажите полный путь внутри хранилища. Wiki-ссылки на заметку будут обновлены.",
        initial: path,
        confirm: "Применить",
        onSubmit: async (to) => {
          await workspace.flush();
          await api().rename(path, to);
          await workspace.renameTab(path, to);
          await workspace.refresh();
          if (/\.(md|canvas|base)$/i.test(to)) await open(to);
        },
      });
    if (action === "trash")
      setDialog({
        title: "Переместить в корзину?",
        description: path + " можно будет восстановить через палитру команд.",
        input: false,
        danger: true,
        confirm: "В корзину",
        onSubmit: async () => {
          await workspace.flush();
          await api().trash(path);
          for (const tab of tabs.filter(
            (t) => t.path === path || t.path.startsWith(path + "/"),
          ))
            await workspace.close(tab.path);
          await workspace.refresh();
        },
      });
  };
  const commands = buildCommands({
    bookmark,
    newFile,
    quickOpen,
    daily,
    unique,
    setGraph: (value) => {
      setHome(false);
      setCollection(null);
      setGraph(value);
    },
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
    compose: (operation) => {
      const snapshot = current && editorSnapshot(current.path, workspace.activePane);
      if (!current || !/\.md$/i.test(current.path)) {
        error("Откройте текстовую заметку");
        return;
      }
      if (operation === "extract" && (!snapshot || snapshot.from === snapshot.to)) {
        error("Сначала выделите текст в редакторе");
        return;
      }
      const source = current.path;
      void run(async () => {
        await workspace.flush();
        setComposer({
          operation,
          source,
          snapshot: snapshot || { content: current.content, from: 0, to: 0 },
        });
      });
    },
    setDialog,
    setPalette,
    tabs,
    active,
    setSlides,
  });
  commands.push(
    {
      id: "bookmark-heading",
      name: "Добавить заголовок в закладки",
      run: () => {
        if (!current) return;
        const path = current.path;
        setPalette({
          placeholder: "Выбрать заголовок…",
          commands: noteHeadings(current.content).map((heading) => ({
            id: heading.id,
            name: heading.text,
            run: () =>
              addBookmark({
                id: crypto.randomUUID(),
                title: heading.text,
                type: "file",
                path,
                fragment: heading.id,
              }),
          })),
        });
      },
    },
    {
      id: "bookmark-block",
      name: "Добавить блок в закладки",
      run: () => {
        if (!current) return;
        const path = current.path;
        setPalette({
          placeholder: "Выбрать блок…",
          commands: referenceBlocks(current.content).map((block) => ({
            id: block.id,
            name: "^" + block.id,
            run: () =>
              addBookmark({
                id: crypto.randomUUID(),
                title: "",
                type: "file",
                path,
                fragment: "^" + block.id,
              }),
          })),
        });
      },
    },
    {
      id: "bookmark-search",
      name: "Добавить поиск в закладки",
      run: () => saveSearch(requestedSearch?.query || ""),
    },
    {
      id: "bookmark-url",
      name: "Добавить веб-адрес в закладки",
      run: () =>
        setDialog({
          title: "Закладка на веб-страницу",
          placeholder: "https://…",
          confirm: "Добавить",
          onSubmit: (url) => {
            addBookmark({ id: crypto.randomUUID(), title: "", type: "url", url });
          },
        }),
    },
  );
  commands.push(
    {
      id: "tab-reopen",
      name: "Открыть закрытую вкладку",
      run: () => void run(workspace.reopenTab),
    },
    {
      id: "tab-close-all",
      name: "Закрыть все незакреплённые вкладки",
      run: () => void run(() => workspace.closeTabs()),
    },
  );
  commands.push({
    id: "properties",
    name: "Открыть все свойства хранилища",
    run: () =>
      void run(async () => {
        await workspace.flush();
        setPropertiesOpen(true);
      }),
  });
  commands.push(
    ...Object.entries(editorActions).map(([id, name]) => ({
      id: "editor-" + id,
      name: "Редактор: " + name,
      run: () => {
        if (!current || !/\.md$/i.test(current.path)) return;
        if (!runEditorAction(current.path, workspace.activePane, id))
          error("Переключитесь в режим редактирования");
      },
    })),
  );
  for (const command of commands)
    command.hint =
      (effectiveHotkeys(preferences?.hotkeys || {})[command.id] || [])
        .map((shortcut) => shortcutLabel(shortcut, isMac))
        .join(", ") || undefined;
  const [installedPlugins, setInstalledPlugins] = useState<PluginInfo[]>([]);
  const pluginCommands: Command[] = installedPlugins
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.commands
        .filter((command) => !p.main || p.registeredCommands?.includes(command.id))
        .map((c) => ({
          id: p.id + ":" + c.id,
          name: p.name + ": " + c.name,
          run: () => {
            if (c.action === "execute") run(() => api().executePlugin(p.id, c.id));
            if (c.action === "insert") insert(c.value || "");
            if (c.action === "open-url") run(() => api().openExternal(c.value || ""));
            if (c.action === "create") newFile("note", c.value);
          },
        })),
    );
  useEffect(() => {
    const refresh = () =>
      api()
        .plugins()
        .then(setInstalledPlugins)
        .catch(() => {});
    void refresh();
    const off = api().onPluginsChanged(refresh);
    return off;
  }, [settings]);
  actionRef.current = (action: string) => {
    if (updatingRef.current) return;
    if (action === "tab-close") {
      if (active) void workspace.close(active);
      return;
    }
    if (action === "navigation-back" || action === "navigation-forward") {
      const next = historyPosition.current + (action === "navigation-back" ? -1 : 1);
      if (next >= 0 && next < openHistory.current.length) {
        historyPosition.current = next;
        void open(openHistory.current[next]);
      }
      return;
    }
    if (action === "home") {
      setHome(true);
      setCollection(null);
      setGraph(false);
      return;
    }
    if (action === "settings") {
      setSettingsTab("appearance");
      setSettings(true);
      return;
    }
    if (action === "commands") {
      setPalette({ commands: [], scope: "commands" });
      return;
    }
    if (action === "toggle-reading") {
      setMode((m) => (m === "read" ? "live" : "read"));
      return;
    }
    if (action === "vault-menu") {
      setRecentOpen((v) => !v);
      return;
    }
    if (action === "request-close") {
      if (recording || audioSave.current) {
        error("Сначала завершите запись и дождитесь её сохранения");
        return;
      }
      run(async () => {
        if (recording) throw Error("Сначала остановите аудиозапись");
        await workspace.flush();
        api().closeReady();
      });
      return;
    }
    [...commands, ...pluginCommands].find((c) => c.id === action)?.run();
  };
  const resolveNote = useMemo(
    () =>
      linkResolver(
        index.map((note) => note.path),
        index,
      ),
    [index],
  );
  const backlinksByPath = useMemo(() => {
    const result = new Map<string, typeof index>();
    for (const note of index) {
      const targets = new Set<string>();
      for (const link of note.links) {
        const target = resolveNote(link, note.path);
        if (!target || target === note.path || targets.has(target)) continue;
        targets.add(target);
        const incoming = result.get(target) || [];
        incoming.push(note);
        result.set(target, incoming);
      }
    }
    return result;
  }, [index, resolveNote]);
  const currentIndex = useMemo(
    () =>
      current?.path.toLowerCase().endsWith(".md")
        ? indexNote(current.path, current.content)
        : null,
    [current?.path, current?.content],
  );
  const outgoing =
    currentIndex?.links.map((target) => ({
      target,
      resolved: resolveNote(target, current!.path),
    })) || [];
  const backlinks = backlinksByPath.get(current?.path || "") || [];
  const footnotes = current?.content.match(/^\[\^[^\]]+\]:.+$/gm) || [];
  const setProperty = (key: string, value: string | undefined, type?: PropertyType) => {
    if (!current) return;
    try {
      if (value === undefined) {
        workspace.edit(current.path, editFrontmatter(current.content, { remove: [key] }));
        return;
      }
      let parsed: unknown = value;
      if (type) {
        let input: unknown = value;
        if (["list", "tags"].includes(type)) {
          try {
            const list = yamlParse(value, { maxAliasCount: 10 });
            if (Array.isArray(list)) input = list;
          } catch {}
        }
        parsed = parseProperty(input, type);
      } else
        try {
          parsed = yamlParse(value, { maxAliasCount: 10 });
        } catch {}
      workspace.edit(
        current.path,
        editFrontmatter(current.content, { set: { [key]: parsed } }),
      );
    } catch (e: any) {
      error(e.message);
    }
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1179px)");
    const collapse = () => {
      if (media.matches) setRight(false);
    };
    media.addEventListener("change", collapse);
    return () => media.removeEventListener("change", collapse);
  }, []);
  useEffect(() => {
    setHome(vault?.preferences.startupView === "home");
    setGraph(false);
    setCollection(null);
    setFileFilter("all");
    setSection("files");
    setRecentOpen(false);
    if (vault?.preferences.dailyOpenOnStartup) void daily();
  }, [vault?.root]);
  const vaultPaths = useMemo(
    () => vault?.files.filter((f) => f.kind !== "folder").map((f) => f.path) || [],
    [vault?.files],
  );
  if (!state)
    return (
      <div className="loading-screen">
        <BrandMark size={46} />
        <span>Veltrite</span>
      </div>
    );
  return (
    <VaultFilesContext.Provider value={vaultPaths}>
      <VaultRuntimeContext.Provider
        value={{
          files: vault?.files || [],
          types: vault?.preferences.propertyTypes || {},
          flush: workspace.flush,
        }}
      >
        <div className="app-shell">
          {updating && (
            <div className="update-lock" role="status">
              <Clock3 size={20} />
              <p>Сохраняем заметки и перезапускаем приложение…</p>
            </div>
          )}
          <WindowTabs
            tabs={tabs}
            active={active}
            vaultOpen={!!vault}
            documentVisible={!!current && !home && !graph && !collection}
            inspectorAvailable={!!current && /\.md$/i.test(current.path)}
            inspectorOpen={right}
            onInspector={() => setRight((v) => !v)}
            onSearch={quickOpen}
            onPin={workspace.pinTab}
            onReorder={workspace.reorderTab}
            onCloseOthers={(path, side) =>
              void run(() => workspace.closeTabs(path, side))
            }
            onClose={(path) => run(() => workspace.close(path))}
            onOpen={(path) => {
              workspace.setActive(path);
              setGraph(false);
              setHome(false);
              setCollection(null);
            }}
          />
          {!vault ? (
            <Welcome
              recent={state.recent}
              onCreate={() => run(() => chooseVault(true))}
              onOpen={() => run(() => chooseVault(false))}
              onImport={importVault}
              onRecent={(root) =>
                run(async () => workspace.switchVault(await api().openRecent(root)))
              }
            />
          ) : (
            <>
              <div className="main-layout">
                <Sidebar
                  key={vault.root}
                  vault={vault}
                  index={index}
                  active={active}
                  onOpen={open}
                  onAction={(a) => actionRef.current(a)}
                  onFileAction={fileAction}
                  onMove={(path, to) =>
                    void run(async () => {
                      await workspace.flush();
                      await api().rename(path, to);
                      await workspace.renameTab(path, to);
                      await workspace.refresh();
                    })
                  }
                  section={section}
                  setSection={setSection}
                  view={
                    graph
                      ? "graph"
                      : collection
                        ? "collection"
                        : home || !current
                          ? "home"
                          : "document"
                  }
                  requestedSearch={requestedSearch}
                  onBookmarkOpen={openBookmark}
                  onBookmarksChange={saveBookmarks}
                  onSaveSearch={saveSearch}
                  pluginButtons={
                    <PluginButtons
                      plugins={installedPlugins}
                      execute={(id, command) =>
                        void run(() => api().executePlugin(id, command))
                      }
                    />
                  }
                  filter={fileFilter}
                  setFilter={(filter) => {
                    setFileFilter(filter);
                    setCollection(filter);
                    setHome(false);
                    setGraph(false);
                  }}
                />
                {recentOpen && (
                  <div className="vault-menu">
                    <strong>Хранилища</strong>
                    {state.recent.map((r) => (
                      <button
                        key={r.root}
                        onClick={() =>
                          run(async () => {
                            await flushForVaultChange();
                            await workspace.switchVault(await api().openRecent(r.root));
                            setRecentOpen(false);
                          })
                        }
                      >
                        <FolderOpen size={15} />
                        {r.name}
                      </button>
                    ))}
                    <hr />
                    <button onClick={() => run(() => chooseVault(true))}>
                      Создать хранилище…
                    </button>
                    <button onClick={() => run(() => chooseVault(false))}>
                      Открыть папку…
                    </button>
                    <button
                      onClick={() => {
                        setRecentOpen(false);
                        importVault();
                      }}
                    >
                      Импорт из папки…
                    </button>
                  </div>
                )}
                <main className="workspace">
                  <DocumentBoundary
                    key={vault.root + graph + home + collection}
                    onSource={() => {
                      setGraph(false);
                      setMode("source");
                    }}
                  >
                    <Suspense
                      fallback={
                        <div className="panel-loading">Загрузка инструмента…</div>
                      }
                    >
                      {graph ? (
                        <Graph
                          files={vault.files}
                          options={preferences!.graph}
                          onOptions={(graph) =>
                            void run(async () =>
                              updatePreferences(await api().preferences({ graph })),
                            )
                          }
                          index={index}
                          active={active}
                          onOpen={(path) => {
                            if (path.startsWith("#")) {
                              setSection("search");
                              setRequestedSearch({
                                query: "tag:" + path.slice(1),
                                id: Date.now(),
                              });
                            } else if (path.startsWith("?")) openLink(path.slice(1));
                            else void open(path);
                          }}
                          bookmark={graphBookmark}
                          onBookmark={(query, local) =>
                            addBookmark({
                              id: crypto.randomUUID(),
                              title: "",
                              type: "graph",
                              query,
                              ...(local ? { local } : {}),
                            })
                          }
                        />
                      ) : collection ? (
                        <FileCollection
                          key={collection}
                          kind={collection}
                          files={vault.files}
                          index={index}
                          onOpen={open}
                          onCreate={(action) => actionRef.current(action)}
                        />
                      ) : current && !home ? (
                        <PaneTree
                          layout={workspace.layout}
                          activePane={workspace.activePane}
                          onFocus={workspace.focusPane}
                          onResize={workspace.resizePane}
                          renderPane={(pane) => {
                            const current = tabs.find((t) => t.path === pane.path);
                            if (!current)
                              return (
                                <div className="empty-pane">
                                  <p>Откройте файл в этой панели</p>
                                  <button onClick={quickOpen}>Выбрать файл</button>
                                  {leaves(workspace.layout).length > 1 && (
                                    <button onClick={() => workspace.closePane(pane.id)}>
                                      Закрыть панель
                                    </button>
                                  )}
                                </div>
                              );
                            return (
                              <DocumentPane
                                current={current}
                                pane={pane}
                                workspace={workspace}
                                index={index}
                                preferences={preferences!}
                                vault={vault}
                                open={open}
                                openLink={openLink}
                                bookmark={bookmark}
                                commands={commands}
                                setDialog={setDialog}
                                setPalette={setPalette}
                                setSelection={setSelection}
                                canGoBack={historyPosition.current > 0}
                                onBack={() => {
                                  if (historyPosition.current > 0) {
                                    historyPosition.current--;
                                    run(() =>
                                      workspace.open(
                                        openHistory.current[historyPosition.current],
                                        pane.id,
                                      ),
                                    );
                                  }
                                }}
                              />
                            );
                          }}
                        />
                      ) : (
                        <WorkspaceHome
                          vault={vault}
                          recentPaths={tabs.map((tab) => tab.path)}
                          onOpen={open}
                          onAction={(action) => actionRef.current(action)}
                        />
                      )}
                    </Suspense>
                  </DocumentBoundary>
                </main>
                {right &&
                  current &&
                  /\.md$/i.test(current.path) &&
                  !home &&
                  !graph &&
                  !collection && (
                    <Inspector
                      currentIndex={currentIndex}
                      currentPath={current?.path || null}
                      mode={mode}
                      onLinkMention={(mention) =>
                        run(async () => {
                          await workspace.flush();
                          await api().linkMention(mention);
                          await workspace.refresh();
                        })
                      }
                      onRevealLine={(path, line) => {
                        void run(async () => {
                          await open(path);
                          workspace.setPaneMode("source");
                          await navigateToNote(
                            path,
                            workspace.activePane,
                            "source",
                            "",
                            line,
                          );
                        });
                      }}
                      backlinks={backlinks}
                      outgoing={outgoing}
                      footnotes={footnotes}
                      open={open}
                      openLink={openLink}
                      setSection={setSection}
                      setProperty={setProperty}
                      propertySchema={preferences!.propertyTypes}
                      setPropertyType={(key, type) =>
                        void run(async () =>
                          updatePreferences(
                            await api().preferences({
                              propertyTypes: {
                                ...preferences!.propertyTypes,
                                [key]: type,
                              },
                            }),
                          ),
                        )
                      }
                      onAllProperties={() =>
                        void run(async () => {
                          await workspace.flush();
                          setPropertiesOpen(true);
                        })
                      }
                      setDialog={setDialog}
                      onClose={() => setRight(false)}
                    />
                  )}
              </div>
              <footer className="statusbar">
                <PluginStatus
                  plugins={installedPlugins}
                  execute={(id, command) =>
                    void run(() => api().executePlugin(id, command))
                  }
                />
                <div
                  className={
                    "save-state " +
                    (tabs.some((t) => t.error)
                      ? "has-error"
                      : tabs.some((t) => t.dirty)
                        ? "is-pending"
                        : "")
                  }
                  aria-live="polite"
                >
                  <span
                    className="status-dot"
                    title={
                      tabs.some((t) => t.error)
                        ? "Ошибка сохранения"
                        : tabs.some((t) => t.dirty)
                          ? "Сохранение"
                          : "Сохранено"
                    }
                  />
                  {tabs.some((t) => t.error)
                    ? "Ошибка сохранения"
                    : tabs.some((t) => t.dirty)
                      ? "Сохранение…"
                      : ""}
                  {recording && (
                    <button
                      className="recording-text"
                      onClick={() => actionRef.current("record")}
                    >
                      Остановить запись
                    </button>
                  )}
                </div>
                <div>
                  <button
                    onClick={sync}
                    aria-label="Синхронизировать"
                    title={
                      state.sync.error ||
                      (state.sync.configured
                        ? "Синхронизировать"
                        : "Подключить GitHub Sync")
                    }
                    className={state.sync.error ? "sync-failed" : ""}
                  >
                    <GitBranch size={12} />
                    {syncing
                      ? "Синхронизация…"
                      : state.sync.error
                        ? "Ошибка синхронизации"
                        : ""}
                  </button>
                  {current &&
                    /\.md$/i.test(current.path) &&
                    !home &&
                    !graph &&
                    !collection && (
                      <>
                        <span>
                          {plural(currentIndex?.words || 0, ["слово", "слова", "слов"])}
                        </span>
                        <span>
                          {plural(current.content.length, [
                            "символ",
                            "символа",
                            "символов",
                          ])}
                        </span>
                      </>
                    )}
                </div>
              </footer>
            </>
          )}
          {settings && preferences && (
            <Suspense fallback={null}>
              <Settings
                commands={[
                  ...commands,
                  ...pluginCommands,
                  { id: "commands", name: "Палитра команд" },
                  { id: "settings", name: "Настройки" },
                  { id: "tab-close", name: "Закрыть вкладку" },
                  { id: "navigation-back", name: "Перейти назад" },
                  { id: "navigation-forward", name: "Перейти вперёд" },
                ]}
                version={state.version}
                onInstallUpdate={async () => {
                  if (recording || audioSave.current)
                    throw Error("Сначала завершите запись и дождитесь её сохранения");
                  const update = await api().updateState();
                  if (update.automatic) {
                    updatingRef.current = true;
                    setUpdating(true);
                  }
                  try {
                    await workspace.flush();
                    await api().installUpdate();
                  } catch (error) {
                    updatingRef.current = false;
                    setUpdating(false);
                    throw error;
                  }
                }}
                preferences={preferences}
                initialTab={settingsTab}
                sync={state.sync}
                onPreferences={updatePreferences}
                onSync={workspace.updateSync}
                onClose={() => setSettings(false)}
                onError={error}
                onMessage={message}
                onImport={() => {
                  setSettings(false);
                  importVault();
                }}
              />
            </Suspense>
          )}
          {palette && (
            <CommandPalette
              commands={
                palette.scope === "commands"
                  ? [...commands, ...pluginCommands].map((command) => ({
                      ...command,
                      run: () => {
                        palette.onPick?.();
                        setTimeout(() => command.run(), 0);
                      },
                    }))
                  : palette.commands
              }
              placeholder={palette.placeholder}
              onClose={() => setPalette(null)}
            />
          )}
          {propertiesOpen && (
            <PropertiesManager
              index={index}
              types={preferences!.propertyTypes}
              onClose={() => setPropertiesOpen(false)}
              onOpen={open}
              onRefresh={workspace.refresh}
              onTypes={async (propertyTypes) =>
                updatePreferences(await api().preferences({ propertyTypes }))
              }
            />
          )}
          {composer && (
            <NoteComposer
              state={composer}
              paths={index.map((note) => note.path)}
              onClose={() => setComposer(null)}
              onSubmit={async (request) => {
                await workspace.flush();
                const result = await api().compose(request);
                if (result.removed) await workspace.close(request.source);
                await workspace.refresh();
                await open(result.target);
                message("Текст перенесён. Предыдущие версии доступны в истории");
              }}
            />
          )}
          {dialog && (
            <Dialog
              key={dialog.title + dialog.initial}
              data={dialog}
              onClose={() => setDialog(null)}
              onError={error}
            />
          )}
          {history && current && (
            <div className="overlay">
              <div className="modal history-modal">
                <div className="modal-title">
                  <h2>История · {current.path}</h2>
                  <button className="icon-button" onClick={() => setHistory(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className="history-body">
                  <div>
                    {history.map((item) => (
                      <div key={item.id} className="history-entry">
                        <button
                          className="history-select"
                          onClick={() =>
                            run(async () =>
                              setHistoryPreview(
                                await api().historyRead(current.path, item.id),
                              ),
                            )
                          }
                        >
                          <Clock3 size={14} />
                          <span>
                            {new Date(item.at).toLocaleString("ru-RU")}
                            <small>{plural(item.size, ["байт", "байта", "байт"])}</small>
                          </span>
                        </button>
                        <button
                          onClick={() =>
                            run(async () => {
                              await workspace.flush();
                              await api().historyRestore(current.path, item.id);
                              await workspace.refresh();
                              setHistory(null);
                              message("Версия восстановлена");
                            })
                          }
                        >
                          Восстановить
                        </button>
                      </div>
                    ))}
                    {!history.length && (
                      <p className="empty-small">Версии появятся после изменений</p>
                    )}
                  </div>
                  <pre>{historyPreview || "Выберите версию для просмотра"}</pre>
                </div>
              </div>
            </div>
          )}
          {trash && (
            <div className="overlay">
              <div className="modal trash-modal">
                <div className="modal-title">
                  <h2>Корзина</h2>
                  <button className="icon-button" onClick={() => setTrash(null)}>
                    <X size={18} />
                  </button>
                </div>
                {trash.map((item) => (
                  <div className="trash-row" key={item.id}>
                    <div>
                      <strong>{item.path}</strong>
                      <small>{new Date(item.at).toLocaleString("ru-RU")}</small>
                    </div>
                    <button
                      onClick={() =>
                        run(async () => {
                          await api().restoreTrash(item.id);
                          setTrash(await api().trashList());
                          await workspace.refresh();
                          message("Файл восстановлен");
                        })
                      }
                    >
                      Восстановить
                    </button>
                  </div>
                ))}
                {!trash.length && <p className="empty-small">Корзина пуста</p>}
              </div>
            </div>
          )}
          {slides !== null && current && (
            <Slides
              content={current.content}
              path={current.path}
              index={index}
              onLink={openLink}
              onClose={() => setSlides(null)}
            />
          )}
          {toast && (
            <div className={"toast " + (toast.error ? "error" : "")} role="status">
              {toast.error ? <span>!</span> : <Check size={17} />}
              <p>{toast.message}</p>
              <button className="icon-button" onClick={() => setToast(null)}>
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </VaultRuntimeContext.Provider>
    </VaultFilesContext.Provider>
  );
}
