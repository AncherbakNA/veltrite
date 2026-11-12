import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  foldAll,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  syntaxHighlighting,
  unfoldAll,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { vim } from "@replit/codemirror-vim";
import { minimalSetup } from "codemirror";
import { useContext, useEffect, useRef } from "react";
import { editorAction } from "../../shared/editor-actions";
import type { NoteIndex, Preferences } from "../../shared/types";
import { registerEditorActions, registerEditorInsertion } from "../editorInsertion";
import { rememberEditor, restoreEditor } from "../editorMemory";
import { noteCompletion } from "../noteCompletion";
import { VaultFilesContext, VaultRuntimeContext } from "../VaultContext";
import { liveBlocks, refreshPreview, type PreviewData } from "./liveBlocks";
import { livePreview } from "./livePreview";
const colors = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text)", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700", color: "var(--text)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--accent-ink)" },
  { tag: tags.monospace, color: "var(--green)", fontFamily: "var(--mono)" },
  { tag: tags.meta, color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);
// Reuse the style module: CodeMirror retains mounted CSS rules for the document lifetime.
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--text)",
  },
  ".cm-content": {
    fontFamily: "var(--note-font)",
    fontSize: "var(--editor-size)",
    lineHeight: "1.6",
    padding: "8px 0 160px",
  },
  ".cm-line": { padding: "0 3px" },
  ".cm-scroller": { fontFamily: "inherit", overflow: "auto" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted)",
    border: "none",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  },
  ".cm-search": { background: "var(--panel)" },
});
export default function Editor({
  content,
  path,
  paneId,
  index,
  onChange,
  preferences,
  onLink,
  onCommand,
  onSelection,
  live = true,
  vaultId,
}: {
  content: string;
  path: string;
  paneId?: string;
  index: NoteIndex[];
  onChange: (text: string) => void;
  preferences: Preferences;
  onLink: (target: string) => void;
  onCommand: (onPick?: () => void) => void;
  onSelection: (text: string) => void;
  live?: boolean;
  vaultId: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    change = useRef(onChange),
    link = useRef(onLink),
    command = useRef(onCommand),
    selection = useRef(onSelection),
    settings = useRef(new Compartment()),
    preview = useRef(new Compartment()),
    vimConfig = useRef(new Compartment());
  const paths = useContext(VaultFilesContext),
    runtime = useContext(VaultRuntimeContext);
  const previewData = useRef<PreviewData>({ path, index, paths, onLink, runtime });
  previewData.current = { path, index, paths, onLink, runtime };
  const getPreviewData = () => previewData.current;
  change.current = onChange;
  const liveRef = useRef(live);
  liveRef.current = live;
  link.current = onLink;
  command.current = onCommand;
  selection.current = onSelection;
  useEffect(() => {
    if (!host.current) return;
    const memoryKey = JSON.stringify([vaultId, path, paneId || "main"]);
    const saved = restoreEditor(memoryKey, content, [
      minimalSetup,
      foldGutter(),
      keymap.of([...foldKeymap, ...completionKeymap]),
      autocompletion({
        override: [(context) => noteCompletion(context, previewData.current)],
      }),
      keymap.of(searchKeymap),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(colors),
      EditorView.lineWrapping,
      preview.current.of(
        live
          ? [
              livePreview((target) => link.current(target), getPreviewData),
              liveBlocks(getPreviewData),
            ]
          : [],
      ),
      vimConfig.current.of(preferences.vimMode ? vim() : []),
      settings.current.of(preferences.lineNumbers ? lineNumbers() : []),
      placeholder("Текст заметки…"),
      editorTheme,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          change.current(update.state.doc.toString());
          let slash = false;
          for (const transaction of update.transactions)
            if (transaction.isUserEvent("input.type"))
              transaction.changes.iterChanges(
                (_from, _to, _newFrom, _newTo, inserted) => {
                  if (inserted.toString() === "/") slash = true;
                },
              );
          const line = update.state.doc.lineAt(update.state.selection.main.head);
          if (slash && liveRef.current && line.text.trim() === "/") {
            const position = line.from + line.text.indexOf("/");
            command.current(() => {
              if (
                view.current === editor &&
                editor.state.sliceDoc(position, position + 1) === "/"
              )
                editor.dispatch({
                  changes: { from: position, to: position + 1, insert: "" },
                });
            });
          }
        }
        if (update.selectionSet) {
          const range = update.state.selection.main;
          selection.current(update.state.sliceDoc(range.from, range.to));
        }
      }),
      EditorView.domEventHandlers({
        click: (event, editor) => {
          if (!(event.metaKey || event.ctrlKey)) return false;
          const pos = editor.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
          if (pos === null) return false;
          const line = editor.state.doc.lineAt(pos);
          for (const match of line.text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            if (
              pos - line.from >= match.index! &&
              pos - line.from <= match.index! + match[0].length
            ) {
              link.current(match[1]);
              return true;
            }
          }
          return false;
        },
        keydown: (event) => {
          if (event.key === "/" && (event.ctrlKey || event.metaKey)) {
            command.current();
            return true;
          }
          return false;
        },
      }),
    ]);
    const editor = new EditorView({ parent: host.current, state: saved.state });
    view.current = editor;
    const restore = requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = saved.scroll;
      const parent = editor.dom.closest(".writing-pane");
      if (parent) parent.scrollTop = saved.parentScroll;
    });
    const range = editor.state.selection.main;
    selection.current(editor.state.sliceDoc(range.from, range.to));
    return () => {
      cancelAnimationFrame(restore);
      rememberEditor(memoryKey, editor);
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== content) {
      const pos = Math.min(editor.state.selection.main.head, content.length);
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
        selection: { anchor: pos },
      });
    }
  }, [content]);
  useEffect(() => {
    view.current?.dispatch({
      effects: settings.current.reconfigure(preferences.lineNumbers ? lineNumbers() : []),
    });
  }, [preferences.lineNumbers]);
  useEffect(() => {
    view.current?.contentDOM.setAttribute("spellcheck", String(preferences.spellcheck));
  }, [preferences.spellcheck]);
  useEffect(() => {
    view.current?.dispatch({
      effects: preview.current.reconfigure(
        live
          ? [
              livePreview((target) => link.current(target), getPreviewData),
              liveBlocks(getPreviewData),
            ]
          : [],
      ),
    });
  }, [live]);
  useEffect(() => {
    view.current?.dispatch({
      effects: vimConfig.current.reconfigure(preferences.vimMode ? vim() : []),
    });
  }, [preferences.vimMode]);
  useEffect(() => {
    view.current?.dispatch({ effects: refreshPreview.of(undefined) });
  }, [index]);
  useEffect(() => {
    const goto = (event: Event) => {
      const editor = view.current;
      if (!editor) return;
      const detail = (event as CustomEvent).detail;
      if (
        detail &&
        typeof detail === "object" &&
        (detail.path !== previewData.current.path ||
          (detail.paneId && detail.paneId !== paneId))
      )
        return;
      const requested = Number(typeof detail === "object" ? detail.line : detail);
      if (!Number.isInteger(requested)) return;
      const line = editor.state.doc.line(
        Math.max(1, Math.min(requested, editor.state.doc.lines)),
      );
      editor.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
      editor.focus();
    };
    window.addEventListener("veltrite:goto", goto);
    return () => window.removeEventListener("veltrite:goto", goto);
  }, []);
  useEffect(() => {
    return registerEditorInsertion(
      path,
      paneId || "main",
      (text) => {
        const editor = view.current;
        if (!editor) throw Error("Редактор закрыт");
        const { from, to } = editor.state.selection.main;
        editor.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        });
        editor.focus();
      },
      () => {
        const editor = view.current!;
        return {
          content: editor.state.doc.toString(),
          from: editor.state.selection.main.from,
          to: editor.state.selection.main.to,
        };
      },
    );
  }, []);
  useEffect(
    () =>
      registerEditorActions(path, paneId || "main", (action) => {
        const editor = view.current;
        if (!editor) return;
        if (action === "fold") {
          foldAll(editor);
          return;
        }
        if (action === "unfold") {
          unfoldAll(editor);
          return;
        }
        const range = editor.state.selection.main;
        const change = editorAction(
          editor.state.doc.toString(),
          range.from,
          range.to,
          action,
        );
        editor.dispatch({
          changes: { from: change.from, to: change.to, insert: change.insert },
          selection: { anchor: change.anchor, head: change.head },
          scrollIntoView: true,
          userEvent: "input.format",
        });
        editor.focus();
      }),
    [],
  );
  return (
    <div
      className={
        "editor-host " +
        (live
          ? "live-editor markdown-source-view mod-cm6"
          : "source-editor markdown-source-view mod-cm6")
      }
      ref={host}
    />
  );
}
