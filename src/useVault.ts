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
import type {
  AppState,
  NoteData,
  NoteIndex,
  SyncStatus,
  VaultInfo,
} from "../shared/types";
export interface Tab extends NoteData {
  savedContent: string;
  dirty: boolean;
  error: string | null;
}
export const api = () => window.veltrite;
async function restoreSession(state: AppState): Promise<Tab[]> {
  const tabs: Tab[] = [];
  for (const path of state.session?.tabs || []) {
    if (
      !state.vault?.files.some(
        (f) => f.path === path && ["note", "canvas", "base"].includes(f.kind),
      )
    )
      continue;
    try {
      const data = await api().read(path);
      tabs.push({
        ...data,
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
  const refresh = useCallback(async () => {
    if (!stateRef.current?.vault) return;
    const [fresh, notes] = await Promise.all([api().state(), api().index()]);
    if (fresh.vault?.root !== stateRef.current?.vault?.root) return;
    const files = fresh.vault!.files;
    setIndex(notes);
    setState(fresh);
    for (const tab of ref.current) {
      if (tab.dirty || saves.current.has(tab.path)) continue;
      if (!files.some((f) => f.path === tab.path)) continue;
      try {
        const disk = await api().read(tab.path);
        if (disk.revision !== tab.revision)
          set((list) =>
            list.map((t) =>
              t.path === disk.path && !t.dirty
                ? {
                    ...disk,
                    savedContent: disk.content,
                    dirty: false,
                    error: null,
                  }
                : t,
            ),
          );
      } catch {}
    }
  }, [set]);
  useEffect(() => {
    let alive = true;
    api()
      .state()
      .then(async (value) => {
        const restored = await restoreSession(value);
        if (!alive) return;
        set(() => restored);
        restoreLayout(
          value.session,
          restored.map((t) => t.path),
        );
        stateRef.current = value;
        setState(value);
        if (value.vault) api().index().then(setIndex);
      })
      .catch((e) => onError(String(e.message)));
    const off = api().onChange(() => {
      refresh().catch(() => {});
    });
    return () => {
      alive = false;
      off();
    };
  }, [refresh, onError, set, restoreLayout]);
  const sessionPaths = JSON.stringify(tabs.map((t) => t.path));
  useEffect(() => {
    if (!state?.vault) return;
    const timer = setTimeout(
      () =>
        api()
          .saveSession(sessionData())
          .catch(() => {}),
      350,
    );
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
      if (!ref.current.some((t) => t.path === path)) {
        const data = await api().read(path);
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
  const close = useCallback(
    async (path: string) => {
      await save(path);
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
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      set(() => []);
      setLayout(singlePane(null));
      const fresh = await api().state();
      if (fresh.vault?.root !== value.root)
        throw Error("Хранилище изменилось во время открытия. Повторите выбор папки.");
      const restored = await restoreSession(fresh);
      set(() => restored);
      restoreLayout(
        fresh.session,
        restored.map((t) => t.path),
      );
      stateRef.current = fresh;
      setState(fresh);
      setIndex(await api().index());
    },
    [set, restoreLayout, setLayout],
  );
  const updateSync = useCallback(
    (sync: SyncStatus) => setState((s) => (s ? { ...s, sync } : s)),
    [],
  );
  const renameTab = useCallback(
    async (from: string, to: string) => {
      const next: Tab[] = [];
      for (const tab of ref.current) {
        if (tab.path !== from && !tab.path.startsWith(from + "/")) {
          next.push(tab);
          continue;
        }
        const data = await api().read(to + tab.path.slice(from.length));
        next.push({ ...data, savedContent: data.content, dirty: false, error: null });
      }
      set(() => next);
      setLayout((old) =>
        replacePaths(old, (path) =>
          path && (path === from || path.startsWith(from + "/"))
            ? to + path.slice(from.length)
            : path,
        ),
      );
    },
    [set, setLayout],
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
    restoreLayout,
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
