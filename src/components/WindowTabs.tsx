import {
  FileText,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Pin,
  Search,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import { fileTitle, isMac, primaryKey } from "../ui";
import type { Tab } from "../useVault";

interface WindowTabsProps {
  tabs: Tab[];
  active: string | null;
  documentVisible: boolean;
  vaultOpen: boolean;
  inspectorOpen: boolean;
  inspectorAvailable: boolean;
  onOpen: (path: string) => void;
  onClose: (path: string) => void;
  onPin: (path: string) => void;
  onReorder: (from: string, to: string) => void;
  onCloseOthers: (path: string, side?: "left" | "right") => void;
  onSearch: () => void;
  onInspector: () => void;
}
export default function WindowTabs({
  tabs,
  active,
  documentVisible,
  vaultOpen,
  inspectorOpen,
  inspectorAvailable,
  onOpen,
  onClose,
  onPin,
  onReorder,
  onCloseOthers,
  onSearch,
  onInspector,
}: WindowTabsProps) {
  const [context, setContext] = useState<{ path: string; x: number; y: number } | null>(
    null,
  );
  return (
    <header className={"tabbar window-tabs " + (isMac ? "platform-mac" : "")}>
      <div className="tabs" role="tablist" aria-label="Открытые файлы">
        {tabs.map((tab) => {
          const Icon = tab.path.endsWith(".canvas")
            ? PanelsTopLeft
            : tab.path.endsWith(".base")
              ? Table2
              : FileText;
          const selected = documentVisible && tab.path === active;
          return (
            <div
              className={
                "tab " + (selected ? "active" : "") + (tab.pinned ? " pinned-tab" : "")
              }
              key={tab.path}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("application/x-veltrite-tab", tab.path)
              }
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onReorder(e.dataTransfer.getData("application/x-veltrite-tab"), tab.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContext({
                  path: tab.path,
                  x: Math.min(e.clientX, window.innerWidth - 220),
                  y: e.clientY,
                });
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && !tab.pinned) onClose(tab.path);
              }}
            >
              <button
                className="tab-open"
                role="tab"
                aria-selected={selected}
                title={tab.path}
                onClick={() => onOpen(tab.path)}
              >
                {tab.pinned ? <Pin size={13} /> : <Icon size={16} />}
                <span>{fileTitle(tab.path)}</span>
                {tab.dirty && (
                  <i className="dirty-dot" aria-label="Есть несохранённые изменения" />
                )}
              </button>
              {!tab.pinned && (
                <button
                  className="tab-close"
                  aria-label={"Закрыть " + tab.path}
                  onClick={() => onClose(tab.path)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
        {!tabs.length && <span className="window-title">Veltrite</span>}
      </div>
      {context && (
        <>
          <div className="menu-dismiss" onPointerDown={() => setContext(null)} />
          <div
            className="tab-context"
            role="menu"
            style={{ left: context.x, top: context.y }}
          >
            <button
              role="menuitem"
              onClick={() => {
                onPin(context.path);
                setContext(null);
              }}
            >
              {tabs.find((tab) => tab.path === context.path)?.pinned
                ? "Открепить вкладку"
                : "Закрепить вкладку"}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onCloseOthers(context.path);
                setContext(null);
              }}
            >
              Закрыть остальные
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onCloseOthers(context.path, "left");
                setContext(null);
              }}
            >
              Закрыть слева
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onCloseOthers(context.path, "right");
                setContext(null);
              }}
            >
              Закрыть справа
            </button>
            <button
              role="menuitem"
              onClick={() => {
                onClose(context.path);
                setContext(null);
              }}
            >
              Закрыть вкладку
            </button>
          </div>
        </>
      )}
      {vaultOpen && (
        <>
          <button
            className="icon-button tab-search"
            title={`Перейти к файлу (${primaryKey}O)`}
            aria-label="Быстрый переход"
            onClick={onSearch}
          >
            <Search size={16} />
          </button>
          <button
            className={"panel-toggle icon-button " + (inspectorOpen ? "active" : "")}
            disabled={!documentVisible || !inspectorAvailable}
            aria-label="Панель заметки"
            aria-expanded={documentVisible && inspectorOpen}
            title={inspectorOpen ? "Скрыть боковую панель" : "Показать боковую панель"}
            onClick={onInspector}
          >
            {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </>
      )}
    </header>
  );
}
