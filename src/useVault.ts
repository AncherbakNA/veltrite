import { useCallback, useEffect, useRef, useState } from "react";
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
  const [active, setActive] = useState<string | null>(null);
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
        setActive(value.session?.active || restored.at(-1)?.path || null);
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
  }, [refresh, onError, set]);
  const sessionPaths = JSON.stringify(tabs.map((t) => t.path));
  useEffect(() => {
    if (!state?.vault) return;
    const timer = setTimeout(
      () =>
        api()
          .saveSession({ tabs: JSON.parse(sessionPaths), active })
          .catch(() => {}),
      350,
    );
    return () => clearTimeout(timer);
  }, [state?.vault?.root, sessionPaths, active]);
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
    if (stateRef.current?.vault)
      await api().saveSession({ tabs: ref.current.map((t) => t.path), active });
  }, [save, active]);
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
    async (path: string) => {
      if (!ref.current.some((t) => t.path === path)) {
        const data = await api().read(path);
        set((list) => [
          ...list,
          { ...data, savedContent: data.content, dirty: false, error: null },
        ]);
      }
      setActive(path);
    },
    [set],
  );
  const close = useCallback(
    async (path: string) => {
      await save(path);
      set((list) => list.filter((t) => t.path !== path));
      setActive((old) => (old === path ? ref.current.at(-1)?.path || null : old));
    },
    [save, set],
  );
  const discard = useCallback(
    (path: string) => {
      const timer = timers.current.get(path);
      if (timer) clearTimeout(timer);
      set((list) => list.filter((tab) => tab.path !== path));
      setActive((old) => (old === path ? ref.current.at(-1)?.path || null : old));
    },
    [set],
  );
  const switchVault = useCallback(
    async (value: VaultInfo) => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      set(() => []);
      setActive(null);
      const fresh = await api().state();
      if (fresh.vault?.root !== value.root)
        throw Error("Хранилище изменилось во время открытия. Повторите выбор папки.");
      const restored = await restoreSession(fresh);
      set(() => restored);
      setActive(fresh.session?.active || restored.at(-1)?.path || null);
      stateRef.current = fresh;
      setState(fresh);
      setIndex(await api().index());
    },
    [set],
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
      setActive((old) =>
        old && (old === from || old.startsWith(from + "/"))
          ? to + old.slice(from.length)
          : old,
      );
    },
    [set],
  );
  return {
    state,
    setState,
    tabs,
    active,
    setActive,
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
