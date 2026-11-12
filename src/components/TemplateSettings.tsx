import { useEffect, useState } from "react";
import { formatDate } from "../../shared/templates";
import type { Preferences } from "../../shared/types";
import { api } from "../useVault";
export default function TemplateSettings({
  preferences,
  update,
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => unknown;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    api()
      .refresh()
      .then((files) => {
        if (alive)
          setPaths(files.filter((file) => file.kind === "note").map((file) => file.path));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <h3>Заметки и шаблоны</h3>
      {(
        [
          ["dailyFormat", "Название ежедневной заметки"],
          ["dailyTemplate", "Шаблон ежедневной заметки"],
          ["uniqueFormat", "Название уникальной заметки"],
          ["uniqueTemplate", "Шаблон уникальной заметки"],
          ["templateDateFormat", "Формат даты в шаблонах"],
          ["templateTimeFormat", "Формат времени в шаблонах"],
        ] as const
      ).map(([key, label]) => (
        <div className="setting-row vertical" key={key}>
          <label htmlFor={key}>{label}</label>
          <input
            id={key}
            defaultValue={preferences[key]}
            list={key.endsWith("Template") ? "template-paths" : undefined}
            placeholder={key.endsWith("Template") ? "Без шаблона" : "YYYY-MM-DD"}
            onBlur={(e) => {
              if (e.target.value !== preferences[key]) update({ [key]: e.target.value });
            }}
          />
          {key.endsWith("Format") && (
            <small className="field-help">
              Сейчас: {formatDate(new Date(), preferences[key])}
            </small>
          )}
        </div>
      ))}
      <datalist id="template-paths">
        {paths.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <label className="setting-row">
        <span>Открывать ежедневную заметку при запуске</span>
        <input
          type="checkbox"
          checked={preferences.dailyOpenOnStartup}
          onChange={(e) => update({ dailyOpenOnStartup: e.target.checked })}
        />
      </label>
      <p className="field-help">
        Переменные:{" "}
        {"{{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD}}, {{time:HH:mm:ss}}"}. Текст в
        квадратных скобках сохраняется буквально: YYYY/[Неделя] WW.
      </p>
    </>
  );
}
