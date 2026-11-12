import { historyField } from "@codemirror/commands";
import { codeFolding, foldState } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
interface Memory {
  json: any;
  scroll: number;
  parentScroll: number;
  bytes: number;
}
const positionKey = "veltrite:editor-positions";
function storedPositions(): Record<
  string,
  { anchor: number; head: number; scroll: number; parentScroll: number }
> {
  try {
    return JSON.parse(localStorage.getItem(positionKey) || "{}");
  } catch {
    return {};
  }
}
const memories = new Map<string, Memory>();
let total = 0;
export function restoreEditor(
  key: string,
  content: string,
  extensions: Extension[],
): { state: EditorState; scroll: number; parentScroll: number } {
  const previous = memories.get(key);
  if (previous?.json.doc === content) {
    try {
      return {
        state: EditorState.fromJSON(
          previous.json,
          { extensions: [codeFolding(), ...extensions] },
          { history: historyField, folds: foldState },
        ),
        scroll: previous.scroll,
        parentScroll: previous.parentScroll,
      };
    } catch {}
  }
  const position = storedPositions()[key];
  const clamp = (value: number) =>
    Number.isSafeInteger(value) ? Math.max(0, Math.min(content.length, value)) : 0;
  return {
    state: EditorState.create({
      doc: content,
      extensions: [codeFolding(), ...extensions],
      selection: { anchor: clamp(position?.anchor), head: clamp(position?.head) },
    }),
    scroll: Number.isFinite(position?.scroll) ? position.scroll : 0,
    parentScroll: Number.isFinite(position?.parentScroll) ? position.parentScroll : 0,
  };
}
export function rememberEditor(key: string, view: EditorView) {
  try {
    const positions = storedPositions();
    delete positions[key];
    positions[key] = {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      scroll: view.scrollDOM.scrollTop,
      parentScroll: view.dom.closest(".writing-pane")?.scrollTop || 0,
    };
    localStorage.setItem(
      positionKey,
      JSON.stringify(Object.fromEntries(Object.entries(positions).slice(-200))),
    );
  } catch {}
  const json = view.state.toJSON({ history: historyField, folds: foldState }),
    bytes = JSON.stringify(json).length * 2;
  const previous = memories.get(key);
  if (previous) total -= previous.bytes;
  memories.delete(key);
  if (bytes > 8 * 1024 * 1024) return;
  memories.set(key, {
    json,
    bytes,
    scroll: view.scrollDOM.scrollTop,
    parentScroll: view.dom.closest(".writing-pane")?.scrollTop || 0,
  });
  total += bytes;
  while (total > 32 * 1024 * 1024 || memories.size > 100) {
    const oldest = memories.keys().next().value!;
    total -= memories.get(oldest)!.bytes;
    memories.delete(oldest);
  }
}
