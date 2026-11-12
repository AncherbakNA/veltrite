import {
  AlignLeft,
  FileText,
  Hash,
  Link2,
  PanelsTopLeft,
  Plus,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import { stringify as yamlStringify } from "yaml";
import type { NoteIndex } from "../../shared/types";
import type { DialogData } from "./Dialog";
interface InspectorProps {
  currentIndex: NoteIndex | null;
  currentPath: string | null;
  mode: string;
  backlinks: NoteIndex[];
  outgoing: { target: string; resolved: string | null }[];
  footnotes: string[];
  open: (path: string) => unknown;
  openLink: (target: string) => void;
  setSection: (section: string) => void;
  setProperty: (key: string, value: string) => void;
  setDialog: (dialog: DialogData) => void;
  onClose: () => void;
}
export default function Inspector({
  currentIndex,
  currentPath,
  mode,
  backlinks,
  outgoing,
  footnotes,
  open,
  openLink,
  setSection,
  setProperty,
  setDialog,
  onClose,
}: InspectorProps) {
  const [rightTab, setRightTab] = useState("outline");
  const canvas = /\.canvas$/i.test(currentPath || ""),
    base = /\.base$/i.test(currentPath || "");
  const tabs = [
    ["outline", AlignLeft, "Содержание"],
    ["links", Link2, "Связи"],
    ["properties", SlidersHorizontal, "Свойства"],
    ["footnotes", Hash, "Сноски"],
  ] as const;
  if (canvas || base) {
    const Icon = canvas ? PanelsTopLeft : Table2;
    const tips = canvas
      ? [
          [
            "Добавьте карточки",
            "Текст, заметки, изображения и ссылки — на панели над холстом.",
          ],
          [
            "Покажите связи",
            "Нажмите «Связь», затем выберите начальную и конечную карточку.",
          ],
          [
            "Посмотрите шире",
            "Инструмент «Перемещение» двигает холст. Масштаб — внизу справа.",
          ],
        ]
      : [
          [
            "Выберите представление",
            "Таблица, карточки, список или доска — в меню над базой.",
          ],
          ["Уточните выборку", "Поле фильтра ищет по названиям и значениям свойств."],
          [
            "Меняйте свойства на месте",
            "Дважды нажмите на ячейку, чтобы изменить свойство заметки.",
          ],
        ];
    return (
      <aside className="inspector context-inspector" aria-label="Подсказки инструмента">
        <div className="inspector-heading">
          <strong>{canvas ? "Работа с холстом" : "Работа с базой"}</strong>
          <button className="icon-button" aria-label="Закрыть панель" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="inspector-content">
          <span className={"context-tool-icon " + (canvas ? "kind-canvas" : "kind-base")}>
            <Icon size={27} />
          </span>
          <h3>{canvas ? "Мысли в одном пространстве" : "Порядок в ваших заметках"}</h3>
          <p className="context-intro">
            {canvas
              ? "Расположите идеи рядом и покажите, как они связаны."
              : "База показывает ваши файлы в удобном представлении."}
          </p>
          <ol className="tool-tips">
            {tips.map(([title, text], i) => (
              <li key={title}>
                <span>{i + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="inspector-footer">
          <span className="local-indicator" />
          Изменения сохраняются автоматически
        </div>
      </aside>
    );
  }
  return (
    <aside className="inspector" aria-label="Информация о заметке">
      <div className="inspector-heading">
        <div>
          <strong>О заметке</strong>
          <small title={currentPath || undefined}>
            {currentIndex?.title || currentPath}
          </small>
        </div>
        <button className="icon-button" aria-label="Закрыть панель" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="inspector-tabs">
        {tabs.map(([id, Icon, title]) => (
          <button
            className={rightTab === id ? "active" : ""}
            key={id}
            title={title}
            aria-pressed={rightTab === id}
            onClick={() => setRightTab(id)}
          >
            <Icon size={16} />
            <span>{title}</span>
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {rightTab === "outline" && (
          <>
            <span className="eyebrow">СОДЕРЖАНИЕ</span>
            {currentIndex?.headings.length ? (
              currentIndex.headings.map((h, i) => (
                <button
                  className="outline-row"
                  key={i}
                  style={{ paddingLeft: (h.level - 1) * 12 }}
                  onClick={() => {
                    if (mode === "read")
                      document
                        .getElementById(h.text.toLowerCase().replace(/\s/g, "-"))
                        ?.scrollIntoView({ behavior: "smooth" });
                    else
                      window.dispatchEvent(
                        new CustomEvent("veltrite:goto", {
                          detail: h.line,
                        }),
                      );
                  }}
                >
                  {h.text}
                </button>
              ))
            ) : (
              <p className="empty-small">Заголовки заметки появятся здесь</p>
            )}
            {currentIndex?.tags.length ? (
              <>
                <span className="eyebrow section-spaced">ТЕГИ ЗАМЕТКИ</span>
                <div className="tags-wrap">
                  {currentIndex.tags.map((t) => (
                    <button className="tag" key={t} onClick={() => setSection("tags")}>
                      #{t}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
        {rightTab === "links" && (
          <>
            <span className="eyebrow">
              ОБРАТНЫЕ ССЫЛКИ <b>{backlinks.length}</b>
            </span>
            {backlinks.map((n) => (
              <button className="simple-row" key={n.path} onClick={() => open(n.path)}>
                <FileText size={14} />
                {n.title}
              </button>
            ))}
            {!backlinks.length && (
              <p className="empty-small">На эту заметку пока нет ссылок</p>
            )}
            <span className="eyebrow section-spaced">
              ИСХОДЯЩИЕ ССЫЛКИ <b>{outgoing.length}</b>
            </span>
            {outgoing.map((n, i) => (
              <button
                className={"simple-row " + (!n.resolved ? "unresolved" : "")}
                key={i}
                onClick={() => openLink(n.target)}
              >
                <Link2 size={14} />
                {n.target}
              </button>
            ))}
          </>
        )}
        {rightTab === "properties" && (
          <>
            <span className="eyebrow">СВОЙСТВА</span>
            {Object.entries(currentIndex?.properties || {}).map(([key, value]) => (
              <div className="property-row" key={key}>
                <label>{key}</label>
                <input
                  aria-label={"Свойство " + key}
                  key={currentPath + key + JSON.stringify(value)}
                  defaultValue={
                    typeof value === "object"
                      ? yamlStringify(value, {
                          flowCollectionPadding: false,
                        }).trim()
                      : String(value)
                  }
                  onBlur={(e) => setProperty(key, e.target.value)}
                />
              </div>
            ))}
            {currentIndex && (
              <button
                className="text-link"
                onClick={() =>
                  setDialog({
                    title: "Новое свойство",
                    placeholder: "Название свойства",
                    confirm: "Добавить",
                    onSubmit: (key) => setProperty(key, '""'),
                  })
                }
              >
                <Plus size={13} />
                Добавить свойство
              </button>
            )}
          </>
        )}
        {rightTab === "footnotes" && (
          <>
            <span className="eyebrow">СНОСКИ</span>
            {footnotes.map((f, i) => (
              <p key={i} className="footnote-item">
                {f}
              </p>
            ))}
            {!footnotes.length && (
              <p className="empty-small">Используйте [^1] и [^1]: текст</p>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <FileText size={13} />
        <span>Markdown · Обычный файл в вашей папке</span>
      </div>
    </aside>
  );
}
