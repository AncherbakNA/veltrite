import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { vim } from "@replit/codemirror-vim";
import { minimalSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { Preferences } from "../../shared/types";
import { livePreview } from "./livePreview";
const colors = HighlightStyle.define([
  { tag: tags.heading, color: "var(--text)", fontWeight: "700" },
  { tag: tags.heading1, fontSize: "1.7em" },
  { tag: tags.heading2, fontSize: "1.35em" },
  { tag: tags.strong, fontWeight: "700", color: "var(--text)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--accent-ink)" },
  { tag: tags.monospace, color: "var(--green)", fontFamily: "var(--mono)" },
  { tag: tags.meta, color: "var(--muted)" },
  { tag: tags.quote, color: "var(--muted)" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
]);
export default function Editor({
  content,
  onChange,
  preferences,
  onLink,
  onCommand,
  onSelection,
  live = true,
}: {
  content: string;
  onChange: (text: string) => void;
  preferences: Preferences;
  onLink: (target: string) => void;
  onCommand: (onPick?: () => void) => void;
  onSelection: (text: string) => void;
  live?: boolean;
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
  change.current = onChange;
  const liveRef = useRef(live);
  liveRef.current = live;
  link.current = onLink;
  command.current = onCommand;
  selection.current = onSelection;
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          minimalSetup,
          keymap.of(searchKeymap),
          highlightSelectionMatches(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(colors),
          EditorView.lineWrapping,
          preview.current.of(live ? livePreview((target) => link.current(target)) : []),
          vimConfig.current.of(preferences.vimMode ? vim() : []),
          settings.current.of(preferences.lineNumbers ? lineNumbers() : []),
          placeholder("Начните писать. Свяжите идею через [[заметку]]…"),
          EditorView.theme({
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
          }),
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
        ],
      }),
    });
    view.current = editor;
    return () => {
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
        live ? livePreview((target) => link.current(target)) : [],
      ),
    });
  }, [live]);
  useEffect(() => {
    view.current?.dispatch({
      effects: vimConfig.current.reconfigure(preferences.vimMode ? vim() : []),
    });
  }, [preferences.vimMode]);
  useEffect(() => {
    const goto = (event: Event) => {
      const editor = view.current;
      if (!editor) return;
      const requested = Number((event as CustomEvent).detail);
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
  return (
    <div
      className={"editor-host " + (live ? "live-editor" : "source-editor")}
      ref={host}
    />
  );
}
