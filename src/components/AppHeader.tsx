import { ChevronRight, Command, HardDrive, RefreshCw, Search } from "lucide-react";
import type { SyncStatus } from "../../shared/types";
import { isMac, primaryKey } from "../ui";
import BrandMark from "./BrandMark";

interface AppHeaderProps {
  vaultName?: string;
  sync: SyncStatus;
  busy: boolean;
  onSearch: () => void;
  onCommands: () => void;
  onSync: () => void;
}

export default function AppHeader({
  vaultName,
  sync,
  busy,
  onSearch,
  onCommands,
  onSync,
}: AppHeaderProps) {
  return (
    <header className={"titlebar " + (isMac ? "platform-mac" : "")}>
      <div className="titlebar-drag">
        <BrandMark size={23} />
        <span className="titlebar-brand">Veltrite</span>
        {vaultName && (
          <>
            <ChevronRight size={12} />
            <span className="titlebar-vault">{vaultName}</span>
          </>
        )}
      </div>
      {vaultName && (
        <button className="global-search" onClick={onSearch} aria-label="Быстрый переход">
          <Search size={15} />
          <span>Найти файл…</span>
          <kbd>{primaryKey} O</kbd>
        </button>
      )}
      <div className="titlebar-right">
        {vaultName ? (
          <>
            <button
              className="header-commands"
              title="Палитра команд"
              aria-label="Палитра команд"
              onClick={onCommands}
            >
              <Command size={16} />
            </button>
            <button
              className={
                "header-sync " +
                (busy ? "spinning" : "") +
                (sync.error ? " sync-failed" : "")
              }
              onClick={onSync}
              title={
                sync.error ||
                (sync.configured
                  ? "Синхронизировать через GitHub"
                  : "Подключить GitHub Sync")
              }
              aria-label="Синхронизировать"
            >
              {sync.configured ? <RefreshCw size={13} /> : <HardDrive size={13} />}
              <span>
                {busy
                  ? "Синхронизация…"
                  : sync.error
                    ? "Ошибка обмена"
                    : sync.configured
                      ? "GitHub Sync"
                      : "На устройстве"}
              </span>
            </button>
          </>
        ) : (
          <span className="header-tagline">Ваши мысли. Ваши файлы.</span>
        )}
      </div>
    </header>
  );
}
