import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import { renderedBlocks, type RenderedBlock } from "../../shared/markdown-blocks";
import type { NoteIndex } from "../../shared/types";
import { VaultFilesContext, VaultRuntimeContext } from "../VaultContext";
import Markdown from "./Markdown";

export interface PreviewData {
  runtime?: import("react").ContextType<typeof VaultRuntimeContext>;
  path: string;
  index: NoteIndex[];
  paths: string[];
  onLink: (target: string) => void;
}
export const refreshPreview = StateEffect.define<void>();
const focusPreview = StateEffect.define<boolean>();
const roots = new WeakMap<HTMLElement, Root>();
const labels = { table: "таблицу", math: "формулу", mermaid: "диаграмму", base: "базу" };

class BlockWidget extends WidgetType {
  constructor(
    private block: RenderedBlock,
    private version: number,
    private data: () => PreviewData,
  ) {
    super();
  }
  eq(other: BlockWidget) {
    return (
      this.version === other.version &&
      this.block.from === other.block.from &&
      this.block.to === other.block.to &&
      this.block.source === other.block.source
    );
  }
  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-rendered-block cm-rendered-" + this.block.kind;
    element.setAttribute("contenteditable", "false");
    const edit = () => {
      view.dispatch({
        selection: { anchor: this.block.from },
        effects: focusPreview.of(true),
      });
      view.focus();
    };
    element.addEventListener("dblclick", (event) => {
      if (!(event.target as Element).closest("a,button,input")) edit();
    });
    const toolbar = document.createElement("button");
    toolbar.className = "cm-block-edit";
    toolbar.type = "button";
    toolbar.textContent = "Править";
    toolbar.setAttribute("aria-label", "Править " + labels[this.block.kind]);
    toolbar.addEventListener("click", edit);
    element.append(toolbar);
    const content = document.createElement("div");
    element.append(content);
    const value = this.data(),
      root = createRoot(content);
    roots.set(element, root);
    root.render(
      <VaultFilesContext.Provider value={value.paths}>
        <VaultRuntimeContext.Provider value={value.runtime || { files: [], types: {} }}>
          <Markdown
            content={this.block.source}
            path={value.path}
            index={value.index}
            onLink={value.onLink}
          />
        </VaultRuntimeContext.Provider>
      </VaultFilesContext.Provider>,
    );
    return element;
  }
  destroy(element: HTMLElement) {
    const root = roots.get(element);
    roots.delete(element);
    queueMicrotask(() => root?.unmount());
  }
  ignoreEvent() {
    return true;
  }
}

export function liveBlocks(data: () => PreviewData) {
  const build = (
    state: EditorState,
    focused: boolean,
    version: number,
  ): DecorationSet => {
    return Decoration.set(
      renderedBlocks(state.doc.toString())
        .filter(
          (block) =>
            !focused ||
            !state.selection.ranges.some(
              (range) => range.from <= block.to && range.to >= block.from,
            ),
        )
        .map((block) =>
          Decoration.replace({
            block: true,
            widget: new BlockWidget(block, version, data),
          }).range(block.from, block.to),
        ),
      true,
    );
  };
  const field = StateField.define<{
    focused: boolean;
    version: number;
    decorations: DecorationSet;
  }>({
    create(state) {
      return { focused: false, version: 0, decorations: build(state, false, 0) };
    },
    update(value, transaction) {
      let focused = value.focused,
        version = value.version,
        changed = false;
      for (const effect of transaction.effects) {
        if (effect.is(focusPreview)) {
          focused = effect.value;
          changed = true;
        }
        if (effect.is(refreshPreview)) {
          version++;
          changed = true;
        }
      }
      return transaction.docChanged || transaction.selection || changed
        ? { focused, version, decorations: build(transaction.state, focused, version) }
        : value;
    },
    provide: (value) => EditorView.decorations.from(value, (state) => state.decorations),
  });
  const focus = ViewPlugin.fromClass(
    class {
      private alive = true;
      constructor(private view: EditorView) {}
      update(update: import("@codemirror/view").ViewUpdate) {
        if (update.focusChanged)
          queueMicrotask(() => {
            if (this.alive)
              this.view.dispatch({ effects: focusPreview.of(this.view.hasFocus) });
          });
      }
      destroy() {
        this.alive = false;
      }
    },
  );
  return [field, focus];
}
