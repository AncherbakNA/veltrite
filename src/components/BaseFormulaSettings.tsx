import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { removeBaseFormula, renameBaseFormula } from "../../shared/base-formulas";
export default function BaseFormulaSettings({
  document,
  onChange,
}: {
  document: Record<string, any>;
  onChange: (document: Record<string, any>) => void;
}) {
  const [error, setError] = useState("");
  const formulas = document.formulas || {};
  return (
    <div className="base-formulas">
      <p className="field-help">
        Формулы доступны во всех представлениях. Свойства заметки: note.price или price,
        свойства файла: file.name. Другие формулы: formula.total.
      </p>
      {Object.entries(formulas).map(([name, expression]) => (
        <div className="base-formula-row" key={name}>
          <div>
            <input
              aria-label={"Имя формулы " + name}
              defaultValue={name}
              onBlur={(e) => {
                try {
                  onChange(renameBaseFormula(document, name, e.target.value.trim()));
                  setError("");
                } catch (error: any) {
                  e.target.value = name;
                  setError(error.message);
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={"Удалить формулу " + name}
              onClick={() => {
                try {
                  onChange(removeBaseFormula(document, name));
                  setError("");
                } catch (error: any) {
                  setError(error.message);
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <textarea
            aria-label={"Выражение формулы " + name}
            spellCheck={false}
            value={String(expression)}
            onChange={(e) =>
              onChange({ ...document, formulas: { ...formulas, [name]: e.target.value } })
            }
            rows={3}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          let name = "новая",
            suffix = 2;
          while (Object.hasOwn(formulas, name)) name = "новая_" + suffix++;
          onChange({ ...document, formulas: { ...formulas, [name]: '""' } });
        }}
      >
        <Plus size={14} />
        Добавить формулу
      </button>
      {error && <p className="save-error">{error}</p>}
      <details className="base-formula-help">
        <summary>Примеры функций</summary>
        <pre>
          {
            'price * count\nif(status == "done", icon("check"), icon("clock"))\nfile.asLink()\nimage(cover)\ntags.unique().join(", ")\n[1,2,3].reduce(acc + value, 0)\n(file.mtime + "7d").format("DD.MM.YYYY")\n/проект/i.matches(file.name)'
          }
        </pre>
      </details>
    </div>
  );
}
