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
import { useEffect, useState } from "react";
import { headingSlugger } from "../../shared/markdown-blocks";
import type { UnlinkedMention } from "../../shared/mentions";
import { propertyType, propertyTypes, type PropertyType } from "../../shared/properties";
import type { NoteIndex } from "../../shared/types";
import { api } from "../useVault";
import type { DialogData } from "./Dialog";
import PropertyField from "./PropertyField";
interface InspectorProps {
  currentIndex: NoteIndex | null;
  currentPath: string | null;
  mode: string;
  onLinkMention: (mention: UnlinkedMention) => Promise<unknown>;
  onRevealLine: (path: string, line: number) => void;
  backlinks: NoteIndex[];
  outgoing: { target: string; resolved: string | null }[];
  footnotes: string[];
  open: (path: string) => unknown;
  openLink: (target: string) => void;
  setSection: (section: string) => void;
  setProperty: (key: string, value: string | undefined, type?: PropertyType) => void;
  propertySchema: Record<string, PropertyType>;
  setPropertyType: (key: string, type: PropertyType) => void;
  onAllProperties: () => void;
  setDialog: (dialog: DialogData) => void;
  onClose: () => void;
}
export default function Inspector({
  currentIndex,
  currentPath,
  onLinkMention,
  onRevealLine,
  backlinks,
  outgoing,
  footnotes,
  open,
  openLink,
  setSection,
  setProperty,
  propertySchema,
  setPropertyType,
  onAllProperties,
  setDialog,
  onClose,
}: InspectorProps) {
  const [sections, setSections] = useState<Record<string, boolean>>({
    outline: true,
    links: true,
  });
  const [mentions, setMentions] = useState<{
      incoming: UnlinkedMention[];
      outgoing: UnlinkedMention[];
      truncated: boolean;
    } | null>(null),
    [mentionsError, setMentionsError] = useState(""),
    [revision, setRevision] = useState(0),
    [linking, setLinking] = useState(false);
  useEffect(() => {
    let alive = true;
    setMentions(null);
    setMentionsError("");
    if (currentPath && sections.unlinked)
      api()
        .mentions(currentPath)
        .then(
          (value) => {
            if (alive) setMentions(value);
          },
          (e) => {
            if (alive) setMentionsError(e.message);
          },
        );
    return () => {
      alive = false;
    };
  }, [currentPath, sections.unlinked, revision]);
  const slug = headingSlugger();
  const headingIds = currentIndex?.headings.map((heading) => slug(heading.text)) || [];
  const renderMentions = (values: UnlinkedMention[]) =>
    values.map((mention, i) => (
      <div className="mention-row" key={mention.path + mention.from + i}>
        <button
          className="mention-context"
          onClick={() => onRevealLine(mention.path, mention.line)}
        >
          <strong>
            {mention.path === currentPath
              ? mention.target.replace(/\.md$/i, "")
              : mention.path.replace(/\.md$/i, "")}
          </strong>
          <span>{mention.context}</span>
          <small>Строка {mention.line}</small>
        </button>
        <button
          className="text-link"
          disabled={linking}
          onClick={async () => {
            setLinking(true);
            try {
              await onLinkMention(mention);
              setRevision((value) => value + 1);
            } finally {
              setLinking(false);
            }
          }}
        >
          Связать
        </button>
      </div>
    ));
  const tabs = [
    ["outline", AlignLeft, "Содержание"],
    ["links", Link2, "Обратные ссылки"],
    ["unlinked", Link2, "Несвязанные упоминания"],
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
                          onClick={() => openLink("#" + headingIds[i])}
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
                {id === "unlinked" && (
                  <>
                    <button
                      className="text-link"
                      onClick={() => setRevision((value) => value + 1)}
                    >
                      Обновить упоминания
                    </button>
                    {mentionsError && <p className="save-error">{mentionsError}</p>}
                    {!mentions && !mentionsError && (
                      <p className="empty-small">Ищем упоминания…</p>
                    )}
                    {mentions && (
                      <>
                        <span className="eyebrow section-spaced">
                          В других заметках · {mentions.incoming.length}
                        </span>
                        {renderMentions(mentions.incoming)}
                        <span className="eyebrow section-spaced">
                          В этой заметке · {mentions.outgoing.length}
                        </span>
                        {renderMentions(mentions.outgoing)}
                        {!mentions.incoming.length && !mentions.outgoing.length && (
                          <p className="empty-small">Несвязанных упоминаний нет</p>
                        )}
                        {mentions.truncated && (
                          <p className="empty-small">
                            Показан ограниченный список упоминаний: до 500 каждого
                            направления и до 15 секунд поиска.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
                {id === "properties" && (
                  <>
                    {Object.entries(currentIndex?.properties || {}).map(
                      ([key, value]) => (
                        <div className="property-row" key={key}>
                          <label title={key}>{key}</label>
                          <select
                            aria-label={"Тип свойства " + key}
                            value={propertySchema[key] || propertyType(value)}
                            onChange={(e) =>
                              setPropertyType(key, e.target.value as PropertyType)
                            }
                          >
                            {Object.entries(propertyTypes).map(([type, label]) => (
                              <option key={type} value={type}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <PropertyField
                            name={key}
                            value={value}
                            type={propertySchema[key]}
                            key={
                              currentPath +
                              key +
                              JSON.stringify(value) +
                              propertySchema[key]
                            }
                            onChange={(value, type) => setProperty(key, value, type)}
                          />
                          <button
                            className="icon-button"
                            aria-label={"Удалить свойство " + key}
                            onClick={() => setProperty(key, undefined)}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ),
                    )}
                    <button className="text-link" onClick={onAllProperties}>
                      Все свойства хранилища
                    </button>
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
