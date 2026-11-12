type Insert = (text: string) => void;
export interface EditorSnapshot {
  content: string;
  from: number;
  to: number;
}
const snapshots = new Map<string, () => EditorSnapshot>();
export function editorSnapshot(path: string, pane: string): EditorSnapshot | null {
  return snapshots.get(keyOf(path, pane))?.() || null;
}
interface Pending {
  text: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const editors = new Map<string, Insert>(),
  pending = new Map<string, Pending[]>();
const keyOf = (path: string, pane: string) => JSON.stringify([path, pane]);
/** A reading pane can mount its editor asynchronously; an insertion waits for that editor. */
export function insertIntoEditor(
  path: string,
  pane: string,
  text: string,
): Promise<void> {
  const key = keyOf(path, pane),
    insert = editors.get(key);
  if (insert) return Promise.resolve().then(() => insert(text));
  return new Promise((resolve, reject) => {
    const queue = pending.get(key) || [];
    if (queue.length >= 16) {
      reject(Error("Слишком много ожидающих вставок"));
      return;
    }
    const item: Pending = {
      text,
      resolve,
      reject,
      timer: setTimeout(() => {
        const rest = (pending.get(key) || []).filter((value) => value !== item);
        if (rest.length) pending.set(key, rest);
        else pending.delete(key);
        reject(Error("Не удалось открыть редактор для вставки"));
      }, 5000),
    };
    pending.set(key, [...queue, item]);
  });
}
export function registerEditorInsertion(
  path: string,
  pane: string,
  insert: Insert,
  snapshot?: () => EditorSnapshot,
) {
  const key = keyOf(path, pane);
  editors.set(key, insert);
  if (snapshot) snapshots.set(key, snapshot);
  const queue = pending.get(key) || [];
  pending.delete(key);
  for (const item of queue) {
    clearTimeout(item.timer);
    try {
      insert(item.text);
      item.resolve();
    } catch (error) {
      item.reject(error instanceof Error ? error : Error("Ошибка вставки"));
    }
  }
  return () => {
    if (editors.get(key) === insert) editors.delete(key);
    if (snapshots.get(key) === snapshot) snapshots.delete(key);
  };
}

const actions = new Map<string, (action: string) => void>();
export function registerEditorActions(
  path: string,
  pane: string,
  run: (action: string) => void,
) {
  const key = keyOf(path, pane);
  actions.set(key, run);
  return () => {
    if (actions.get(key) === run) actions.delete(key);
  };
}
export function runEditorAction(path: string, pane: string, action: string): boolean {
  const run = actions.get(keyOf(path, pane));
  if (!run) return false;
  run(action);
  return true;
}
