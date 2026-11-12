import { useRef, type ReactNode } from "react";
import type { DocumentLeaf, PaneLayout } from "../../shared/panes";
interface Props {
  layout: PaneLayout;
  activePane: string;
  onFocus: (id: string) => void;
  onResize: (id: string, ratio: number) => void;
  renderPane: (pane: DocumentLeaf) => ReactNode;
}
export default function PaneTree(props: Props) {
  const { layout, activePane, onFocus, onResize, renderPane } = props;
  const host = useRef<HTMLDivElement>(null);
  if (layout.kind === "leaf")
    return (
      <section
        className={
          "document-leaf workspace-leaf-content" +
          (layout.id === activePane ? " focused-pane" : "")
        }
        data-pane-id={layout.id}
        aria-label={"Панель: " + (layout.path || "пустая")}
        onPointerDownCapture={() => onFocus(layout.id)}
        onFocusCapture={() => onFocus(layout.id)}
      >
        {renderPane(layout)}
      </section>
    );
  const row = layout.direction === "row";
  return (
    <div ref={host} className={"pane-split split-" + layout.direction}>
      <div className="pane-branch" style={{ flexBasis: `${layout.ratio * 100}%` }}>
        <PaneTree {...props} layout={layout.first} />
      </div>
      <div
        className="pane-divider"
        role="separator"
        tabIndex={0}
        aria-label="Размер панелей"
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(layout.ratio * 100)}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -0.05
              : event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 0.05
                : 0;
          if (delta) {
            event.preventDefault();
            onResize(layout.id, layout.ratio + delta);
          }
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !host.current)
            return;
          const rect = host.current.getBoundingClientRect();
          onResize(
            layout.id,
            row
              ? (event.clientX - rect.left) / rect.width
              : (event.clientY - rect.top) / rect.height,
          );
        }}
      />
      <div className="pane-branch" style={{ flexBasis: `${(1 - layout.ratio) * 100}%` }}>
        <PaneTree {...props} layout={layout.second} />
      </div>
    </div>
  );
}
