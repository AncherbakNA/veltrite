import {
  ArrowUpRight,
  ChevronRight,
  FileText,
  FolderOpen,
  GitBranch,
  Import,
  PanelsTopLeft,
  Plus,
} from "lucide-react";
export default function Welcome({
  recent,
  onCreate,
  onOpen,
  onImport,
  onRecent,
}: {
  recent: { root: string; name: string }[];
  onCreate: () => void;
  onOpen: () => void;
  onImport: () => void;
  onRecent: (root: string) => void;
}) {
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="logo-mark">V</div>
        <span className="eyebrow">ВАША ЛИЧНАЯ БАЗА ЗНАНИЙ</span>
        <h1>
          Мысли, которые
          <br />
          <em>находят друг друга.</em>
        </h1>
        <p>
          Пишите, связывайте и исследуйте идеи.
          <br />В обычных файлах. В своём пространстве.
        </p>
        <div className="welcome-actions">
          <button className="primary" onClick={onCreate}>
            <Plus size={18} />
            Создать хранилище
          </button>
          <button onClick={onOpen}>
            <FolderOpen size={18} />
            Открыть папку
          </button>
        </div>
        <button className="text-link" onClick={onImport}>
          <Import size={15} />
          Перенести хранилище из Obsidian
          <ArrowUpRight size={14} />
        </button>
        {!!recent.length && (
          <div className="recent-vaults">
            <span className="eyebrow">НЕДАВНИЕ ХРАНИЛИЩА</span>
            {recent.map((item) => (
              <button key={item.root} onClick={() => onRecent(item.root)}>
                <FolderOpen size={16} />
                <span>
                  {item.name}
                  <small>{item.root}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        )}
        <div className="welcome-features">
          <span>
            <FileText size={15} />
            Markdown
          </span>
          <span>
            <PanelsTopLeft size={15} />
            Холсты
          </span>
          <span>
            <GitBranch size={15} />
            GitHub Sync
          </span>
        </div>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="art-orbit orbit-one" />
        <div className="art-orbit orbit-two" />
        <div className="art-crystal">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="art-node node-one" />
        <div className="art-node node-two" />
        <div className="art-node node-three" />
        <div className="art-caption">
          СОБИРАЙТЕ ЗНАНИЯ.
          <br />
          ОТКРЫВАЙТЕ СВЯЗИ.
        </div>
      </div>
    </div>
  );
}
