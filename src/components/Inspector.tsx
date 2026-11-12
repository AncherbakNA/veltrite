import {
  AlignLeft,
  ChevronRight,
  FileText,
  Hash,
  Link2,
  Plus,
  SlidersHorizontal,
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
  const [sections, setSections] = useState<Record<string, boolean>>({
    outline: true,
    links: true,
  });
  const tabs = [
    ["outline", AlignLeft, "Содержание"],
    ["links", Link2, "Обратные ссылки"],
    ["properties", SlidersHorizontal, "Свойства"],
    ["footnotes", Hash, "Сноски"],
  ] as const;
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
      <div className="inspector-content inspector-sections">
        {tabs.map(([id, Icon, title]) => (
          <section className="inspector-section" key={id}>
            <button
              className="inspector-section-toggle"
              aria-label={title}
              aria-expanded={!!sections[id]}
              onClick={() => setSections((value) => ({ ...value, [id]: !value[id] }))}
            >
              <ChevronRight size={14} className={sections[id] ? "expanded" : ""} />
              <Icon size={16} />
              <span>{title}</span>
              {id === "links" && <small>{backlinks.length}</small>}
            </button>
            {sections[id] && (
              <div className="inspector-section-body">
                {id === "outline" && (
                  <>
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
                        <span className="eyebrow section-spaced">Теги заметки</span>
                        <div className="tags-wrap">
                          {currentIndex.tags.map((t) => (
                            <button
                              className="tag"
                              key={t}
                              onClick={() => setSection("tags")}
                            >
                              #{t}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </>
                )}
                {id === "links" && (
                  <>
                    {backlinks.map((n) => (
                      <button
                        className="simple-row"
                        key={n.path}
                        onClick={() => open(n.path)}
                      >
                        <FileText size={14} />
                        {n.title}
                      </button>
                    ))}
                    {!backlinks.length && (
                      <p className="empty-small">На эту заметку пока нет ссылок</p>
                    )}
                    <span className="eyebrow section-spaced">
                      Исходящие ссылки <b>{outgoing.length}</b>
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
                {id === "properties" && (
                  <>
                    {Object.entries(currentIndex?.properties || {}).map(
                      ([key, value]) => (
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
                      ),
                    )}
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
                {id === "footnotes" && (
                  <>
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
            )}
          </section>
        ))}
      </div>
    </aside>
  );
}
