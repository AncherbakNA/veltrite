import { ChevronRight, FolderOpen, Import, Plus } from "lucide-react";
import BrandMark from "./BrandMark";
interface WelcomeProps {
  recent: { root: string; name: string }[];
  onCreate: () => void;
  onOpen: () => void;
  onImport: () => void;
  onRecent: (root: string) => void;
}
export default function Welcome({
  recent,
  onCreate,
  onOpen,
  onImport,
  onRecent,
}: WelcomeProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-brand">
          <BrandMark size={40} />
          <h1>Veltrite</h1>
        </div>
        <p>Заметки, холсты и базы в локальной папке.</p>
        <div className="welcome-actions">
          <button className="welcome-action primary" onClick={onCreate}>
            <Plus size={18} />
            <span>
              <strong>Создать хранилище</strong>
              <small>Выбрать папку для новых заметок</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="welcome-action" onClick={onOpen}>
            <FolderOpen size={18} />
            <span>
              <strong>Открыть папку</strong>
              <small>Открыть существующие файлы</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="welcome-action" onClick={onImport}>
            <Import size={18} />
            <span>
              <strong>Импорт из папки</strong>
              <small>Скопировать заметки и вложения</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
        {!!recent.length && (
          <div className="recent-vaults">
            <h2>Недавние хранилища</h2>
            {recent.map((item) => (
              <button key={item.root} onClick={() => onRecent(item.root)}>
                <FolderOpen size={16} />
                <span>
                  {item.name}
                  <small>{item.root}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
