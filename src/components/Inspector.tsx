import { AlignLeft, FileText, Hash, Link2, Plus, SlidersHorizontal } from "lucide-react";
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
}: InspectorProps) {
  const [rightTab, setRightTab] = useState("outline");
  return (
    <aside className="inspector">
      <div className="inspector-tabs">
        {[
          ["outline", AlignLeft, "Содержание"],
          ["links", Link2, "Связи"],
          ["properties", SlidersHorizontal, "Свойства"],
          ["footnotes", Hash, "Сноски"],
        ].map(([id, Icon, title]: any) => (
          <button
            className={rightTab === id ? "active" : ""}
            key={id}
            title={title}
            onClick={() => setRightTab(id)}
          >
            <Icon size={16} />
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
        <span className="mini-logo">V</span>
        <span>Одна мысль ведёт к другой.</span>
      </div>
    </aside>
  );
}
