import { useCallback, useEffect, useRef, useState } from "react";
import {
  leaves,
  normalizeSession,
  removePane,
  singlePane,
  updatePane,
  type PaneLayout,
  type PaneMode,
  type WorkspaceSession,
} from "../shared/panes";
import { movedPath, rewriteMarkdownLinks } from "../shared/rename-links";
import type {
  AppState,
  FileEntry,
  NoteData,
  NoteIndex,
  SyncStatus,
  VaultInfo,
} from "../shared/types";
export interface Tab extends NoteData {
  pinned?: boolean;
  savedContent: string;
  dirty: boolean;
  error: string | null;
}
export const api = () => window.veltrite;
async function readTab(path: string, files: FileEntry[] = []): Promise<NoteData> {
  if (/\.(md|canvas|base)$/i.test(path)) return api().read(path);
  const file = files.find((file) => file.path === path);
  return {
    path,
    content: "",
    revision: file ? `${file.modified}:${file.size}` : "attachment",
  };
}
async function restoreSession(state: AppState): Promise<Tab[]> {
  const tabs: Tab[] = [];
  for (const path of state.session?.tabs || []) {
    if (!state.vault?.files.some((f) => f.path === path && f.kind !== "folder")) continue;
    try {
      const data = await readTab(path, state.vault?.files);
      tabs.push({
        ...data,
        pinned: state.session?.pinned?.includes(path) || false,
        savedContent: data.content,
        dirty: false,
        error: null,
      });
    } catch {}
  }
  return tabs;
}
export function useVault(onError: (message: string) => void) {
  const [state, setState] = useState<AppState | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [layout, setLayoutState] = useState<PaneLayout>(singlePane(null));
  const [activePane, setActivePane] = useState("main");
  const layoutRef = useRef(layout),
    focusRef = useRef(activePane);
  const setLayout = useCallback(
    (next: PaneLayout | ((old: PaneLayout) => PaneLayout)) => {
      layoutRef.current = typeof next === "function" ? next(layoutRef.current) : next;
      setLayoutState(layoutRef.current);
    },
    [],
  );
  const focusPane = useCallback((id: string) => {
    if (!leaves(layoutRef.current).some((p) => p.id === id)) return;
    focusRef.current = id;
    setActivePane(id);
  }, []);
  const setActive = useCallback(
    (next: string | null | ((old: string | null) => string | null)) => {
      setLayout((old) =>
        updatePane(old, focusRef.current, (p) =>
          p.kind === "leaf"
            ? { ...p, path: typeof next === "function" ? next(p.path) : next }
            : p,
        ),
      );
    },
    [setLayout],
  );
  const focused = leaves(layout).find((p) => p.id === activePane) || leaves(layout)[0];
  const active = focused.path;
  const restoreLayout = useCallback(
    (session: WorkspaceSession | null, paths: string[]) => {
      const next = normalizeSession(
        session || { tabs: paths, active: paths.at(-1) || null },
        new Set(paths),
      );
      setLayout(next.layout!);
      focusRef.current = next.activePane!;
      setActivePane(next.activePane!);
    },
    [setLayout],
  );
  const sessionData = useCallback(
    (): WorkspaceSession => ({
      tabs: ref.current.map((t) => t.path),
      pinned: ref.current.filter((tab) => tab.pinned).map((tab) => tab.path),
      active:
        leaves(layoutRef.current).find((p) => p.id === focusRef.current)?.path || null,
      layout: layoutRef.current,
      activePane: focusRef.current,
    }),
    [],
  );
  const [index, setIndex] = useState<NoteIndex[]>([]);
  const ref = useRef(tabs),
    stateRef = useRef(state),
    timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    saves = useRef(new Map<string, Promise<void>>());
  const set = useCallback((fn: (tabs: Tab[]) => Tab[]) => {
    ref.current = fn(ref.current);
    setTabs(ref.current);
  }, []);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const epoch = useRef(0),
    refreshPending = useRef<Promise<void> | null>(null),
    refreshRequested = useRef(false),
    refreshForced = useRef(false);
  const refresh = useCallback(
    (force = true): Promise<void> => {
      refreshRequested.current = true;
      refreshForced.current ||= force;
      if (refreshPending.current) return refreshPending.current;
      const pending = (async () => {
        do {
          refreshRequested.current = false;
          const forced = refreshForced.current;
          refreshForced.current = false;
          const root = stateRef.current?.vault?.root,
            generation = epoch.current;
          if (!root) continue;
          const fresh = await api().state();
          const valid = () =>
            generation === epoch.current && stateRef.current?.vault?.root === root;
          if (!valid() || fresh.vault?.root !== root) continue;
          const previous = stateRef.current?.vault?.files;
          const changed =
            forced ||
            !previous ||
            previous.length !== fresh.vault.files.length ||
            previous.some((file, i) => {
              const next = fresh.vault!.files[i];
              return (
                file.path !== next.path ||
                file.size !== next.size ||
                file.modified !== next.modified ||
                file.kind !== next.kind
              );
            });
          if (changed) {
            const notes = await api().index();
            if (!valid()) continue;
            setIndex(notes);
          } else fresh.vault.files = previous!;
          const paths = new Set(fresh.vault.files.map((file) => file.path));
          stateRef.current = fresh;
          setState(fresh);
          for (const tab of changed ? ref.current : []) {
            if (!valid()) break;
            if (tab.dirty || saves.current.has(tab.path) || !paths.has(tab.path))
              continue;
            try {
              const disk = await readTab(tab.path, fresh.vault.files);
              if (!valid()) break;
              if (disk.revision !== tab.revision)
                set((list) =>
                  list.map((current) =>
                    current.path === disk.path &&
                    !current.dirty &&
                    current.revision === tab.revision &&
                    !saves.current.has(current.path)
                      ? {
                          ...current,
                          ...disk,
                          savedContent: disk.content,
                          dirty: false,
                          error: null,
                        }
                      : current,
                  ),
                );
            } catch {}
          }
        } while (refreshRequested.current);
      })().finally(() => {
        if (refreshPending.current === pending) refreshPending.current = null;
      });
      refreshPending.current = pending;
      return pending;
    },
    [set],
  );
  useEffect(() => {
    let alive = true;
    const generation = epoch.current;
    api()
      .state()
      .then(async (value) => {
        const restored = await restoreSession(value);
        if (!alive || generation !== epoch.current) return;
        set(() => restored);
        restoreLayout(
          value.session,
          restored.map((t) => t.path),
        );
        stateRef.current = value;
        setState(value);
        if (value.vault)
          api()
            .index()
            .then((notes) => {
              if (alive && generation === epoch.current) setIndex(notes);
            })
            .catch((e) => onError(e.message));
      })
      .catch((e) => onError(String(e.message)));
    const off = api().onChange((reason) => {
      refresh(reason !== "settings").catch(() => {});
    });
    return () => {
      alive = false;
      off();
    };
  }, [refresh, onError, set, restoreLayout]);
  const sessionPaths = JSON.stringify(tabs.map((t) => [t.path, !!t.pinned]));
  useEffect(() => {
    if (!state?.vault) return;
    const root = state.vault.root;
    const timer = setTimeout(() => {
      if (stateRef.current?.vault?.root === root)
        api()
          .saveSession(sessionData())
          .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [state?.vault?.root, sessionPaths, layout, activePane, sessionData]);
  const save = useCallback(
    async (path: string) => {
      const existing = saves.current.get(path);
      if (existing) {
        await existing;
      }
      const tab = ref.current.find((t) => t.path === path);
      if (!tab?.dirty) return;
      const timer = timers.current.get(path);
      if (timer) clearTimeout(timer);
      const pending = (async () => {
        try {
          const result = await api().write(path, tab.content, tab.revision);
          set((list) =>
            list.map((t) =>
              t.path === path
                ? {
                    ...t,
                    revision: result.revision,
                    savedContent: result.content,
                    dirty: t.content !== result.content,
                    error: null,
                  }
                : t,
            ),
          );
        } catch (e: any) {
          set((list) =>
            list.map((t) => (t.path === path ? { ...t, error: e.message } : t)),
          );
          throw e;
        }
      })();
      saves.current.set(path, pending);
      try {
        await pending;
      } finally {
        saves.current.delete(path);
      }
    },
    [set],
  );
  const flush = useCallback(async () => {
    while (true) {
      await Promise.all([...saves.current.values()]);
      const dirty = ref.current.filter((tab) => tab.dirty);
      if (!dirty.length) break;
      for (const tab of dirty) await save(tab.path);
    }
    if (stateRef.current?.vault) await api().saveSession(sessionData());
  }, [save, sessionData]);
  const edit = useCallback(
    (path: string, content: string) => {
      set((list) =>
        list.map((t) =>
          t.path === path
            ? { ...t, content, dirty: content !== t.savedContent, error: null }
            : t,
        ),
      );
      const old = timers.current.get(path);
      if (old) clearTimeout(old);
      timers.current.set(
        path,
        setTimeout(() => save(path).catch((e) => onError(e.message)), 650),
      );
    },
    [save, set, onError],
  );
  const open = useCallback(
    async (path: string, paneId?: string) => {
      const generation = epoch.current;
      if (!ref.current.some((t) => t.path === path)) {
        if (ref.current.length >= 100)
          throw Error("Закройте одну из 100 вкладок перед открытием новой");
        const data = await readTab(path, stateRef.current?.vault?.files);
        if (generation !== epoch.current) return;
        set((list) =>
          list.some((t) => t.path === path)
            ? list
            : [
                ...list,
                { ...data, savedContent: data.content, dirty: false, error: null },
              ],
        );
      }
      if (paneId) focusPane(paneId);
      setActive(path);
    },
    [set, setActive, focusPane],
  );
  const closedTabs = useRef<string[]>([]);
  const close = useCallback(
    async (path: string) => {
      await save(path);
      closedTabs.current = [
        ...closedTabs.current.filter((value) => value !== path),
        path,
      ].slice(-30);
      set((list) => list.filter((t) => t.path !== path));
      setLayout((old) =>
        replacePaths(old, (p) => (p === path ? ref.current.at(-1)?.path || null : p)),
      );
    },
    [save, set, setLayout],
  );
  const discard = useCallback(
    (path: string) => {
      const timer = timers.current.get(path);
      if (timer) clearTimeout(timer);
      set((list) => list.filter((tab) => tab.path !== path));
      setLayout((old) =>
        replacePaths(old, (p) => (p === path ? ref.current.at(-1)?.path || null : p)),
      );
    },
    [set, setLayout],
  );
  const switchVault = useCallback(
    async (value: VaultInfo) => {
      const generation = ++epoch.current;
      stateRef.current = null;
      setIndex([]);
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      set(() => []);
      setLayout(singlePane(null));
      const fresh = await api().state();
      if (fresh.vault?.root !== value.root)
        throw Error("Хранилище изменилось во время открытия. Повторите выбор папки.");
      const restored = await restoreSession(fresh);
      if (generation !== epoch.current) return;
      set(() => restored);
      restoreLayout(
        fresh.session,
        restored.map((t) => t.path),
      );
      stateRef.current = fresh;
      setState(fresh);
      const notes = await api().index();
      if (generation === epoch.current) setIndex(notes);
    },
    [set, restoreLayout, setLayout],
  );
  const updateSync = useCallback(
    (sync: SyncStatus) => setState((s) => (s ? { ...s, sync } : s)),
    [],
  );
  const renameTab = useCallback(
    async (from: string, to: string) => {
      const paths =
        state?.vault?.files
          .filter((file) => file.kind !== "folder")
          .map((file) => file.path) || [];
      const isDirectory =
        state?.vault?.files.find((file) => file.path === from)?.kind === "folder";
      const snapshot = [...ref.current];
      const reads = await Promise.all(
        snapshot.map(async (tab) => {
          const path = movedPath(tab.path, from, to, isDirectory);
          try {
            return [
              tab.path,
              await readTab(path, stateRef.current?.vault?.files),
            ] as const;
          } catch {
            return [tab.path, null] as const;
          }
        }),
      );
      const fresh = new Map(reads);
      set((list) =>
        list.map((tab) => {
          const path = movedPath(tab.path, from, to, isDirectory),
            data = fresh.get(tab.path);
          if (path !== tab.path) {
            const timer = timers.current.get(tab.path);
            if (timer) clearTimeout(timer);
            timers.current.delete(tab.path);
          }
          if (!data) return { ...tab, path };
          const content =
            tab.dirty && /\.md$/i.test(tab.path)
              ? rewriteMarkdownLinks(
                  tab.content,
                  tab.path,
                  path,
                  from,
                  to,
                  isDirectory,
                  paths,
                  index,
                )
              : tab.dirty
                ? tab.content
                : data.content;
          return {
            ...tab,
            ...data,
            content,
            savedContent: data.content,
            dirty: content !== data.content,
            error: null,
          };
        }),
      );
      setLayout((old) =>
        replacePaths(old, (path) =>
          path ? movedPath(path, from, to, isDirectory) : path,
        ),
      );
      for (const tab of ref.current)
        if (tab.dirty) {
          const timer = timers.current.get(tab.path);
          if (timer) clearTimeout(timer);
          timers.current.set(
            tab.path,
            setTimeout(
              () => save(tab.path).catch((error) => onError(error.message)),
              650,
            ),
          );
        }
    },
    [set, setLayout, save, state?.vault?.files, index, onError],
  );
  const splitPane = (direction: "row" | "column", id = focusRef.current) => {
    if (leaves(layoutRef.current).length >= 16) {
      onError("Можно открыть до 16 панелей");
      return;
    }
    const newId = crypto.randomUUID();
    const next = updatePane(layoutRef.current, id, (node) =>
      node.kind === "leaf"
        ? {
            kind: "split",
            id: crypto.randomUUID(),
            direction,
            ratio: 0.5,
            first: node,
            second: { ...node, id: newId },
          }
        : node,
    );
    try {
      normalizeSession({ ...sessionData(), layout: next, activePane: newId });
    } catch (error: any) {
      onError(error.message);
      return;
    }
    setLayout(next);
    focusPane(newId);
    return newId;
  };
  const closePane = (id: string) => {
    const next = removePane(layoutRef.current, id);
    if (!next) return;
    setLayout(next);
    if (focusRef.current === id) focusPane(leaves(next)[0].id);
  };
  const setPaneMode = (
    mode: PaneMode | ((old: PaneMode) => PaneMode),
    id = focusRef.current,
  ) =>
    setLayout((old) =>
      updatePane(old, id, (pane) =>
        pane.kind === "leaf"
          ? { ...pane, mode: typeof mode === "function" ? mode(pane.mode) : mode }
          : pane,
      ),
    );
  return {
    state,
    setState,
    tabs,
    active,
    setActive,
    layout,
    activePane,
    focusPane,
    splitPane,
    closePane,
    setPaneMode,
    resizePane: (id: string, ratio: number) =>
      setLayout((old) =>
        updatePane(old, id, (node) =>
          node.kind === "split"
            ? { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) }
            : node,
        ),
      ),
    sessionData,
    restoreLayout: (session: WorkspaceSession | null, paths: string[]) => {
      set((tabs) =>
        tabs.map((tab) => ({
          ...tab,
          pinned: session?.pinned?.includes(tab.path) || false,
        })),
      );
      restoreLayout(session, paths);
    },
    pinTab: (path: string) =>
      set((tabs) =>
        tabs
          .map((tab) => (tab.path === path ? { ...tab, pinned: !tab.pinned } : tab))
          .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
      ),
    reorderTab: (from: string, to: string) =>
      set((tabs) => {
        const moving = tabs.find((tab) => tab.path === from);
        if (!moving) return tabs;
        const rest = tabs.filter((tab) => tab.path !== from),
          at = rest.findIndex((tab) => tab.path === to);
        rest.splice(at < 0 ? rest.length : at, 0, moving);
        return rest.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
      }),
    reopenTab: async () => {
      const path = closedTabs.current.pop();
      if (path) await open(path);
    },
    closeTabs: async (except?: string, side?: "left" | "right") => {
      const values = ref.current.slice(),
        position = values.findIndex((tab) => tab.path === except);
      for (let i = 0; i < values.length; i++)
        if (
          !values[i].pinned &&
          values[i].path !== except &&
          (!side || (side === "left" ? i < position : i > position))
        )
          await close(values[i].path);
    },
    mode: focused.mode,
    index,
    refresh,
    flush,
    save,
    edit,
    open,
    close,
    discard,
    switchVault,
    updateSync,
    renameTab,
    current: tabs.find((t) => t.path === active) || null,
  };
}

function replacePaths(
  layout: PaneLayout,
  replace: (path: string | null) => string | null,
): PaneLayout {
  return layout.kind === "leaf"
    ? { ...layout, path: replace(layout.path) }
    : {
        ...layout,
        first: replacePaths(layout.first, replace),
        second: replacePaths(layout.second, replace),
      };
}
