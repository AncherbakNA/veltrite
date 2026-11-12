import {
  FileText,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  Search,
  Table2,
  X,
} from "lucide-react";
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
  onSearch,
  onInspector,
}: WindowTabsProps) {
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
            <div className={"tab " + (selected ? "active" : "")} key={tab.path}>
              <button
                className="tab-open"
                role="tab"
                aria-selected={selected}
                title={tab.path}
                onClick={() => onOpen(tab.path)}
              >
                <Icon size={16} />
                <span>{fileTitle(tab.path)}</span>
                {tab.dirty && (
                  <i className="dirty-dot" aria-label="Есть несохранённые изменения" />
                )}
              </button>
              <button
                className="tab-close"
                aria-label={"Закрыть " + tab.path}
                onClick={() => onClose(tab.path)}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        {!tabs.length && <span className="window-title">Veltrite</span>}
      </div>
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
