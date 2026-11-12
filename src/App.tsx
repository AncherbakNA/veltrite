import { Check, Clock3, FolderOpen, GitBranch, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { plural } from "../shared/format";
import { frontmatter, indexNote, resolveLink } from "../shared/markdown";
import { headingId, referenceBlocks } from "../shared/markdown-blocks";
import type { HistoryItem, PluginInfo, Preferences } from "../shared/types";
import { VaultFilesContext } from "./VaultContext";
import { buildCommands } from "./commands";
import BrandMark from "./components/BrandMark";
import {
  CommandPalette,
  Dialog,
  type Command,
  type DialogData,
} from "./components/Dialog";
import DocumentBoundary from "./components/DocumentBoundary";
import DocumentToolbar from "./components/DocumentToolbar";
import FileCollection from "./components/FileCollection";
import Inspector from "./components/Inspector";
import Markdown from "./components/Markdown";
import Sidebar, { type FileFilter } from "./components/Sidebar";
import Welcome from "./components/Welcome";
import WindowTabs from "./components/WindowTabs";
import WorkspaceHome from "./components/WorkspaceHome";
import { scrollToNoteAnchor } from "./navigation";
import { api, useVault } from "./useVault";
const Editor = lazy(() => import("./components/Editor"));
const Canvas = lazy(() => import("./components/Canvas"));
const Graph = lazy(() => import("./components/Graph"));
const Bases = lazy(() => import("./components/Bases"));
const Settings = lazy(() => import("./components/Settings"));
type Mode = "live" | "source" | "read" | "split";
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
  const workspace = useVault(error);
  const { state, tabs, active, current, index } = workspace;
  const vault = state?.vault || null,
    preferences = vault?.preferences;
  const currentRef = useRef(current);
  currentRef.current = current;
  const [section, setSection] = useState("files"),
    [mode, setMode] = useState<Mode>("live"),
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
    };
    applyTheme();
    system.addEventListener("change", applyTheme);
    document.documentElement.style.setProperty(
      "--editor-size",
      preferences.fontSize + "px",
    );
    document.documentElement.style.setProperty("--accent", preferences.accent);
    document.documentElement.dataset.textFont = preferences.textFont;
    const rgb = preferences.accent
      .slice(1)
      .match(/../g)!
      .map((part) => {
        const n = parseInt(part, 16) / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    document.documentElement.style.setProperty(
      "--accent-button-text",
      luminance > 0.179 ? "#000000" : "#ffffff",
    );
    return () => system.removeEventListener("change", applyTheme);
  }, [preferences]);
  useEffect(() => api().onMenu((action) => actionRef.current(action)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPalette(null);
        setDialog(null);
        setSettings(false);
        setHistory(null);
        setTrash(null);
        setSlides(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const command = (
        {
          KeyN: "new-note",
          KeyO: "quick-open",
          KeyP: "commands",
          KeyS: e.shiftKey ? "sync" : "save",
          Comma: "settings",
          KeyE: "toggle-reading",
          KeyF: e.shiftKey ? "search" : null,
        } as Record<string, string | null>
      )[e.code];
      if (command) {
        e.preventDefault();
        actionRef.current(command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const open = useCallback(
    (path: string) =>
      run(async () => {
        const entry = vault?.files.find((f) => f.path === path);
        if (entry?.kind === "attachment") {
          await api().openAttachment(path);
          return;
        }
        await workspace.open(path);
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
    workspace.edit(
      draft.path,
      draft.content + (draft.content.endsWith("\n") ? "" : "\n") + text,
    );
  };
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
  const openLink = (target: string) => {
    const paths =
      vault?.files.filter((f) => f.kind !== "folder").map((f) => f.path) || [];
    const resolved = resolveLink(target, current?.path || "", paths, index);
    if (resolved)
      run(async () => {
        await open(resolved);
        const subpath = target.split("#")[1];
        if (!subpath) return;
        const tab = tabs.find((t) => t.path === resolved),
          text = tab?.content || (await api().read(resolved)).content;
        const heading = indexNote(resolved, text).headings.find(
          (h) =>
            h.text.toLocaleLowerCase() === subpath.toLocaleLowerCase() ||
            headingId(h.text) === headingId(subpath),
        );
        const block = subpath.startsWith("^")
          ? referenceBlocks(text).find((item) => item.id === subpath.slice(1))
          : null;
        setTimeout(() => {
          scrollToNoteAnchor(
            resolved,
            subpath.startsWith("^") ? "block-" + subpath.slice(1) : headingId(subpath),
          );
          if (heading || block)
            window.dispatchEvent(
              new CustomEvent("veltrite:goto", {
                detail: { path: resolved, line: heading?.line || block!.line },
              }),
            );
        }, 60);
      });
    else if (target.startsWith("#"))
      document
        .getElementById(target.slice(1).toLowerCase().replace(/\s/g, "-"))
        ?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
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
  const chooseVault = async (create = false) => {
    setSettings(false);
    await workspace.flush();
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
      setSettings(false);
      await workspace.flush();
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
      commands: (
        vault?.files.filter((f) => ["note", "canvas", "base"].includes(f.kind)) || []
      ).map((f) => ({
        id: f.path,
        name: f.path.replace(/\.(md|canvas|base)$/i, ""),
        group: f.kind === "canvas" ? "Холст" : f.kind === "base" ? "База" : "Заметка",
        run: () => open(f.path),
      })),
    });
  const daily = () =>
    run(async () => {
      const now = new Date(),
        date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
        path = preferences!.dailyFolder + "/" + date + ".md";
      if (!vault?.files.some((f) => f.path === path))
        await api().create(
          path,
          `---\ndate: ${date}\ntags: [дневник]\n---\n# ${now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}\n\n`,
        );
      await workspace.refresh();
      await open(path);
    });
  const bookmark = () =>
    run(async () => {
      if (!current || !preferences) return;
      const list = preferences.bookmarks.includes(current.path)
        ? preferences.bookmarks.filter((p) => p !== current.path)
        : [...preferences.bookmarks, current.path];
      updatePreferences(await api().preferences({ bookmarks: list }));
    });
  const record = () =>
    run(async () => {
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
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        run(async () => {
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
      };
      audio.start();
      setRecording(true);
    });
  const fileAction = (action: string, path: string) => {
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
    selection,
    setDialog,
    setPalette,
    tabs,
    active,
    setSlides,
  });
  const [installedPlugins, setInstalledPlugins] = useState<PluginInfo[]>([]);
  const pluginCommands: Command[] = installedPlugins
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.commands.map((c) => ({
        id: p.id + ":" + c.id,
        name: p.name + ": " + c.name,
        run: () => {
          if (c.action === "insert") insert(c.value || "");
          if (c.action === "open-url") run(() => api().openExternal(c.value || ""));
          if (c.action === "create") newFile("note", c.value);
        },
      })),
    );
  useEffect(() => {
    api()
      .plugins()
      .then(setInstalledPlugins)
      .catch(() => {});
  }, [settings]);
  actionRef.current = (action: string) => {
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
      setPalette({ commands: [...commands, ...pluginCommands] });
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
      run(async () => {
        if (recording) throw Error("Сначала остановите аудиозапись");
        await workspace.flush();
        api().closeReady();
      });
      return;
    }
    [...commands, ...pluginCommands].find((c) => c.id === action)?.run();
  };
  const currentIndex = current?.path.toLowerCase().endsWith(".md")
    ? indexNote(current.path, current.content)
    : null;
  const outgoing =
    currentIndex?.links.map((target) => ({
      target,
      resolved: resolveLink(
        target,
        current!.path,
        index.map((n) => n.path),
        index,
      ),
    })) || [];
  const backlinks = index.filter(
    (n) =>
      n.path !== current?.path &&
      n.links.some(
        (link) =>
          resolveLink(
            link,
            n.path,
            index.map((n) => n.path),
            index,
          ) === current?.path,
      ),
  );
  const footnotes = current?.content.match(/^\[\^[^\]]+\]:.+$/gm) || [];
  const setProperty = (key: string, value: string) => {
    if (!current) return;
    const { properties, body } = frontmatter(current.content);
    if (["__proto__", "constructor", "prototype"].includes(key)) return;
    let parsed: unknown = value;
    try {
      parsed = yamlParse(value, { maxAliasCount: 10 });
    } catch {}
    workspace.edit(
      current.path,
      "---\n" +
        yamlStringify({ ...properties, [key]: parsed }).trimEnd() +
        "\n---\n" +
        body,
    );
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
  }, [vault?.root]);
  if (!state)
    return (
      <div className="loading-screen">
        <BrandMark size={46} />
        <span>Veltrite</span>
      </div>
    );
  return (
    <VaultFilesContext.Provider
      value={vault?.files.filter((f) => f.kind !== "folder").map((f) => f.path) || []}
    >
      <div className="app-shell">
        <WindowTabs
          tabs={tabs}
          active={active}
          vaultOpen={!!vault}
          documentVisible={!!current && !home && !graph && !collection}
          inspectorAvailable={!!current && /\.md$/i.test(current.path)}
          inspectorOpen={right}
          onInspector={() => setRight((v) => !v)}
          onSearch={quickOpen}
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
                          await workspace.flush();
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
                  key={(current?.path || "") + mode + graph + home + collection}
                  onSource={() => {
                    setGraph(false);
                    setMode("source");
                  }}
                >
                  <Suspense
                    fallback={<div className="panel-loading">Загрузка инструмента…</div>}
                  >
                    {graph ? (
                      <Graph index={index} active={active} onOpen={open} />
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
                      <>
                        <DocumentToolbar
                          path={current.path}
                          mode={mode}
                          setMode={setMode}
                          canGoBack={historyPosition.current > 0}
                          onBack={() => {
                            if (historyPosition.current > 0) {
                              historyPosition.current--;
                              run(() =>
                                workspace.open(
                                  openHistory.current[historyPosition.current],
                                ),
                              );
                            }
                          }}
                          bookmarked={preferences!.bookmarks.includes(current.path)}
                          onBookmark={bookmark}
                          onActions={() =>
                            setPalette({
                              commands: commands.filter((command) =>
                                [
                                  "source",
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
                                  initial:
                                    current.path.replace(/\.[^.]+$/, "") +
                                    " (моя правка)",
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
                        {current.path.toLowerCase().endsWith(".canvas") &&
                        mode !== "source" ? (
                          <Canvas
                            key={current.path}
                            content={current.content}
                            onChange={(text) => workspace.edit(current.path, text)}
                            index={index}
                            onOpen={open}
                            onChooseFile={(add) =>
                              setPalette({
                                placeholder: "Выберите файл для холста…",
                                commands: vault.files
                                  .filter(
                                    (f) => f.kind !== "folder" && f.path !== current.path,
                                  )
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
                        ) : current.path.toLowerCase().endsWith(".base") &&
                          mode !== "source" ? (
                          <Bases
                            content={current.content}
                            index={index}
                            files={vault.files}
                            onOpen={open}
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
                                  index={index}
                                  onChange={(text) => workspace.edit(current.path, text)}
                                  preferences={preferences!}
                                  onLink={openLink}
                                  onCommand={(onPick) =>
                                    setPalette({
                                      commands: [...commands, ...pluginCommands].map(
                                        (command) => ({
                                          ...command,
                                          run: () => {
                                            onPick?.();
                                            setTimeout(
                                              () => actionRef.current(command.id),
                                              0,
                                            );
                                          },
                                        }),
                                      ),
                                    })
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
                                  onLink={openLink}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </>
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
                    backlinks={backlinks}
                    outgoing={outgoing}
                    footnotes={footnotes}
                    open={open}
                    openLink={openLink}
                    setSection={setSection}
                    setProperty={setProperty}
                    setDialog={setDialog}
                    onClose={() => setRight(false)}
                  />
                )}
            </div>
            <footer className="statusbar">
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
            commands={palette.commands}
            placeholder={palette.placeholder}
            onClose={() => setPalette(null)}
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
          <div
            className="slides-overlay"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight")
                setSlides((i) =>
                  Math.min((i || 0) + 1, current.content.split(/^---$/m).length - 1),
                );
              if (e.key === "ArrowLeft") setSlides((i) => Math.max(0, (i || 0) - 1));
            }}
          >
            <button className="slides-close icon-button" onClick={() => setSlides(null)}>
              <X size={24} />
            </button>
            <div className="slide">
              <Markdown
                content={frontmatter(current.content).body.split(/^---$/m)[slides] || ""}
                path={current.path}
                index={index}
                onLink={openLink}
              />
            </div>
            <div className="slides-controls">
              <button onClick={() => setSlides((i) => Math.max(0, (i || 0) - 1))}>
                ←
              </button>
              <span>
                {slides + 1} / {frontmatter(current.content).body.split(/^---$/m).length}
              </span>
              <button
                onClick={() =>
                  setSlides((i) =>
                    Math.min(
                      (i || 0) + 1,
                      frontmatter(current.content).body.split(/^---$/m).length - 1,
                    ),
                  )
                }
              >
                →
              </button>
            </div>
          </div>
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
    </VaultFilesContext.Provider>
  );
}
