import type { Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
class WikiWidget extends WidgetType {
  constructor(
    private target: string,
    private label: string,
    private open: (target: string) => void,
  ) {
    super();
  }
  eq(other: WikiWidget) {
    return other.target === this.target && other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-wiki-link";
    span.textContent = this.label;
    span.title = this.target;
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.open(this.target);
    });
    return span;
  }
}
class TaskWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private position: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return this.checked === other.checked && this.position === other.position;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", "Задача");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      view.dispatch({
        changes: {
          from: this.position,
          to: this.position + 1,
          insert: this.checked ? " " : "x",
        },
      });
    });
    return box;
  }
}
export function livePreview(open: (target: string) => void) {
  const build = (view: EditorView) => {
    const ranges: Range<Decoration>[] = [];
    const cursor = view.state.selection.main;
    for (const visible of view.visibleRanges) {
      let from = visible.from;
      while (from <= visible.to) {
        const line = view.state.doc.lineAt(from),
          text = line.text;
        const active = cursor.from <= line.to && cursor.to >= line.from;
        const level = /^(#{1,6})\s/.exec(text)?.[1].length;
        if (level)
          ranges.push(
            Decoration.line({ class: "cm-note-h" + Math.min(level, 3) }).range(line.from),
          );
        if (/^>\s?/.test(text))
          ranges.push(Decoration.line({ class: "cm-note-quote" }).range(line.from));

        if (!active) {
          const heading = /^#{1,6}\s/.exec(text);
          if (heading)
            ranges.push(
              Decoration.replace({}).range(line.from, line.from + heading[0].length),
            );
          const occupied: { from: number; to: number }[] = [];
          for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
            const start = line.from + match.index!,
              end = start + match[0].length;
            ranges.push(
              Decoration.replace({
                widget: new WikiWidget(match[1], match[2] || match[1], open),
              }).range(start, end),
            );
            occupied.push({ from: start, to: end });
          }
          for (const match of text.matchAll(/(\*\*|__|`)(.+?)\1/g)) {
            const start = line.from + match.index!,
              size = match[1].length,
              end = start + match[0].length;
            if (occupied.some((r) => start < r.to && end > r.from)) continue;
            ranges.push(
              Decoration.replace({}).range(start, start + size),
              Decoration.replace({}).range(end - size, end),
            );
          }
          const task = /^\s*[-*]\s+\[([ xX])\]/.exec(text);
          if (task) {
            const start = line.from + task[0].indexOf("[");
            ranges.push(
              Decoration.replace({
                widget: new TaskWidget(task[1].toLowerCase() === "x", start + 1),
              }).range(start, start + 3),
            );
          }
        }
        if (line.to >= view.state.doc.length) break;
        from = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet)
          this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
