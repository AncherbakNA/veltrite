import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  HardDrive,
  Import,
  Link2,
  PanelsTopLeft,
  Plus,
  ShieldCheck,
} from "lucide-react";
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
          <BrandMark size={42} />
          <span>
            Veltrite<small>Пространство для ваших мыслей</small>
          </span>
        </div>
        <span className="eyebrow">ЗАМЕЧАЙТЕ. СОХРАНЯЙТЕ. СВЯЗЫВАЙТЕ.</span>
        <h1>
          Хорошим идеям
          <br />
          нужно своё место<span>.</span>
        </h1>
        <p>
          Заметки, холсты и связи между ними.
          <br />
          Всё в вашей папке, в удобном порядке.
        </p>
        <div className="welcome-actions">
          <button className="welcome-action primary" onClick={onCreate}>
            <Plus size={20} />
            <span>
              <strong>Создать хранилище</strong>
              <small>Новое пространство для заметок</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button className="welcome-action" onClick={onOpen}>
            <FolderOpen size={20} />
            <span>
              <strong>Открыть папку</strong>
              <small>Продолжить работу с вашими файлами</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button className="welcome-action" onClick={onImport}>
            <Import size={20} />
            <span>
              <strong>Перенести из Obsidian</strong>
              <small>Скопировать заметки, связи и холсты</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>
        {!!recent.length && (
          <div className="recent-vaults">
            <span className="eyebrow">НЕДАВНО ОТКРЫВАЛИ</span>
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
        <div className="welcome-assurance">
          <HardDrive size={14} />
          <span>Работает без интернета</span>
          <span>·</span>
          <ShieldCheck size={14} />
          <span>Файлы под вашим контролем</span>
        </div>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="welcome-art-grid" />
        <div className="welcome-art-label">
          <span className="local-indicator" />У каждой мысли есть продолжение
        </div>
        <div className="welcome-note note-back">
          <span className="mock-note-caption">
            <PanelsTopLeft size={14} />
            Карта идей
          </span>
          <div className="mock-mini-graph">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="mock-note-footer">Посмотрите на картину целиком</span>
        </div>
        <div className="welcome-note note-front">
          <span className="mock-note-caption">
            <FileText size={14} />
            Маленькие шаги
          </span>
          <h2>
            Всё начинается
            <br />с одной мысли.
          </h2>
          <p>
            Запишите наблюдение.
            <br />
            Найдите связь.
            <br />
            Вернитесь с новой идеей.
          </p>
          <span className="mock-wiki-link">
            <Link2 size={13} />
            Личная база знаний
          </span>
          <div className="mock-note-check">
            <Check size={14} />
            Сделать первый шаг
          </div>
        </div>
        <div className="welcome-art-footer">
          <BrandMark size={26} />
          <span>
            Свободное пространство.
            <br />
            <strong>Для всего, что важно вам.</strong>
          </span>
          <ArrowUpRight size={20} />
        </div>
      </div>
    </div>
  );
}
