import {
  Copy,
  ExternalLink,
  GitBranch,
  Info,
  KeyRound,
  LogOut,
  Palette,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  TextCursorInput,
  X,
} from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { PluginInfo, Preferences, SyncStatus } from "../../shared/types";
import { useDialogFocus } from "../useDialogFocus";
import { api } from "../useVault";
import BrandMark from "./BrandMark";
export default function Settings({
  preferences,
  initialTab = "appearance",
  sync,
  onPreferences,
  onSync,
  onClose,
  onError,
  onMessage,
  onImport,
}: {
  preferences: Preferences;
  initialTab?: string;
  sync: SyncStatus;
  onPreferences: (p: Preferences) => void;
  onSync: (s: SyncStatus) => void;
  onClose: () => void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
  onImport: () => void;
}) {
  const [tab, setTab] = useState(initialTab),
    [selectedTheme, setSelectedTheme] = useState(preferences.theme),
    [repository, setRepository] = useState(sync.repository),
    [token, setToken] = useState(""),
    [recovery, setRecovery] = useState(""),
    [shownKey, setShownKey] = useState(""),
    [keySaved, setKeySaved] = useState(sync.recoverySaved),
    [busy, setBusy] = useState(false),
    [device, setDevice] = useState(""),
    [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const dialog = useDialogFocus<HTMLDivElement>();
  useEffect(() => setSelectedTheme(preferences.theme), [preferences.theme]);
  useEffect(() => {
    api()
      .plugins()
      .then(setPlugins)
      .catch(() => {});
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<Preferences>) =>
    run(async () => onPreferences(await api().preferences(patch)));
  const chooseTheme = (theme: Preferences["theme"]) => {
    setSelectedTheme(theme);
    run(async () => {
      try {
        onPreferences(await api().preferences({ theme }));
      } catch (error) {
        setSelectedTheme(preferences.theme);
        throw error;
      }
    });
  };
  const sections = [
    ["appearance", Palette, "Оформление"],
    ["editor", TextCursorInput, "Редактор"],
    ["sync", GitBranch, "GitHub Sync"],
    ["plugins", Puzzle, "Расширения"],
    ["about", Info, "О приложении"],
  ] as const;
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
      >
        <nav className="settings-nav">
          <span className="eyebrow">Настройки</span>
          {sections.map(([id, Icon, title]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => setTab(id)}
            >
              <Icon size={17} />
              {title}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <button
            className="settings-close icon-button"
            onClick={onClose}
            aria-label="Закрыть настройки"
          >
            <X size={20} />
          </button>
          {tab === "appearance" && (
            <>
              <h2>Оформление</h2>

              <fieldset className="theme-picker">
                <legend>Цветовая тема</legend>

                <div className="theme-choices">
                  {(
                    [
                      ["dark", "Тёмная"],
                      ["light", "Светлая"],
                      ["system", "Системная"],
                    ] as const
                  ).map(([theme, label]) => (
                    <label
                      key={theme}
                      className={
                        "theme-choice " + (selectedTheme === theme ? "selected" : "")
                      }
                    >
                      <input
                        type="radio"
                        name="theme"
                        aria-label={label}
                        value={theme}
                        checked={selectedTheme === theme}
                        onChange={() => chooseTheme(theme)}
                        disabled={busy}
                      />
                      <span className={"theme-sample sample-" + theme} aria-hidden="true">
                        <i />
                        <span>
                          <b />
                          <i />
                          <i />
                          <i />
                        </span>
                      </span>
                      <span className="theme-choice-label">{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="accent-picker">
                <legend>Акцентный цвет</legend>
                <div
                  className="accent-swatches"
                  role="radiogroup"
                  aria-label="Акцентный цвет"
                >
                  {[
                    ["#c0603a", "Охра"],
                    ["#3d63b8", "Чернила"],
                    ["#51785b", "Зелёный"],
                    ["#946341", "Коричневый"],
                    ["#906176", "Сливовый"],
                    ["#61747d", "Серый"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-label={label}
                      aria-checked={preferences.accent.toLowerCase() === value}
                      disabled={busy}
                      className="accent-swatch"
                      style={{ "--swatch": value } as CSSProperties}
                      onClick={() => update({ accent: value })}
                    />
                  ))}
                  <label className="custom-accent">
                    Свой
                    <input
                      aria-label="Свой акцентный цвет"
                      placeholder="#c0603a"
                      defaultValue={preferences.accent}
                      key={preferences.accent}
                      maxLength={7}
                      pattern="#[0-9a-fA-F]{6}"
                      onBlur={(e) => {
                        if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                          update({ accent: e.target.value });
                        else e.target.value = preferences.accent;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>
              </fieldset>
              <div className="setting-row">
                <label htmlFor="text-font">Шрифт текста</label>
                <select
                  id="text-font"
                  value={preferences.textFont}
                  onChange={(e) =>
                    update({ textFont: e.target.value as Preferences["textFont"] })
                  }
                >
                  <option value="serif">С засечками</option>
                  <option value="sans">Без засечек</option>
                  <option value="mono">Моноширинный</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Размер шрифта</strong>
                  <small>{preferences.fontSize} px</small>
                </div>
                <input
                  aria-label="Размер шрифта"
                  type="range"
                  min="11"
                  max="28"
                  value={preferences.fontSize}
                  onChange={(e) => update({ fontSize: Number(e.target.value) })}
                />
              </div>
              <div className="setting-row">
                <label htmlFor="startup-view">При запуске открывать</label>
                <select
                  id="startup-view"
                  value={preferences.startupView}
                  onChange={(e) =>
                    update({ startupView: e.target.value as Preferences["startupView"] })
                  }
                >
                  <option value="last-note">Последнюю заметку</option>
                  <option value="home">Главную</option>
                </select>
              </div>
              <Toggle
                label="Ограничить ширину строки"
                description="Более удобное чтение длинных заметок"
                checked={preferences.readableLineLength}
                onChange={(v) => update({ readableLineLength: v })}
              />
            </>
          )}
          {tab === "editor" && (
            <>
              <h2>Редактор</h2>
              <Toggle
                label="Режим Vim"
                description="Клавиши Vim в редакторе"
                checked={preferences.vimMode}
                onChange={(v) => update({ vimMode: v })}
              />
              <Toggle
                label="Номера строк"
                checked={preferences.lineNumbers}
                onChange={(v) => update({ lineNumbers: v })}
              />
              <Toggle
                label="Проверка орфографии"
                checked={preferences.spellcheck}
                onChange={(v) => update({ spellcheck: v })}
              />
              <div className="setting-row">
                <span>Копирование готового хранилища</span>
                <button onClick={onImport}>Импорт из папки</button>
              </div>
              {(
                [
                  ["dailyFolder", "Ежедневные заметки"],
                  ["attachmentFolder", "Вложения"],
                  ["templatesFolder", "Шаблоны"],
                ] as const
              ).map(([key, title]) => (
                <div className="setting-row vertical" key={key}>
                  <label htmlFor={key}>{title}</label>
                  <input
                    id={key}
                    defaultValue={preferences[key]}
                    onBlur={(e) => {
                      if (e.target.value !== preferences[key])
                        update({ [key]: e.target.value });
                    }}
                  />
                </div>
              ))}
              <div className="info-card">
                Горячие клавиши: ⌘/Ctrl + N — заметка, O — переход, P — команды, S —
                сохранить, Shift + S — синхронизация. ⌘/Ctrl + клик открывает [[ссылку]] в
                редакторе.
              </div>
            </>
          )}
          {tab === "sync" && (
            <>
              <h2>GitHub Sync</h2>
              {sync.error && <div className="save-error">{sync.error}</div>}
              <p className="muted">
                Личный приватный репозиторий для всех ваших устройств.
              </p>
              <div className="security-card">
                <ShieldCheck size={22} />
                <div>
                  <strong>Сквозное шифрование включено</strong>
                  <small>Названия и содержимое файлов шифруются перед отправкой.</small>
                </div>
              </div>
              <label className="field-label" htmlFor="repo">
                Приватный репозиторий
              </label>
              <input
                id="repo"
                placeholder="username/veltrite-sync"
                value={repository}
                onChange={(e) => setRepository(e.target.value.trim())}
              />
              {sync.deviceFlowAvailable && (
                <>
                  <button
                    className="wide"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const code = await api().beginLogin();
                        setDevice(code.userCode);
                        await api().finishLogin();
                        setDevice("");
                        onMessage("Вход выполнен. Теперь подключите репозиторий.");
                      })
                    }
                  >
                    <GitBranch size={16} />
                    Войти через GitHub
                  </button>
                  {device && (
                    <div className="device-code">
                      <strong>{device}</strong>
                      <small>Введите этот код на github.com/login/device</small>
                      <button
                        onClick={() => {
                          api().cancelLogin();
                          setDevice("");
                        }}
                      >
                        Отменить вход
                      </button>
                    </div>
                  )}
                </>
              )}
              <label className="field-label" htmlFor="github-token">
                Токен выбранного репозитория{" "}
                {sync.configured ? "(для повторного входа)" : ""}
              </label>
              <input
                id="github-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={
                  sync.configured
                    ? "Оставьте пустым, чтобы сохранить вход"
                    : "github_pat_…"
                }
              />
              <small className="field-help">
                Fine-grained token: выберите только этот репозиторий и Contents → Read and
                write. Токен хранится зашифрованным средствами ОС.
              </small>
              <button
                className="text-link"
                onClick={() =>
                  api().openExternal(
                    "https://github.com/settings/personal-access-tokens/new",
                  )
                }
              >
                Создать токен в GitHub <ExternalLink size={12} />
              </button>
              <label className="field-label" htmlFor="recovery">
                Ключ восстановления
              </label>
              <input
                id="recovery"
                type="password"
                autoComplete="off"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value.trim())}
                placeholder="Для нового хранилища оставьте пустым"
              />
              <small className="field-help">
                На втором компьютере введите ключ с первого устройства.
              </small>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !repository}
                  onClick={() =>
                    run(async () => {
                      const result = await api().syncConnect({
                        repository,
                        token: token || undefined,
                        key: recovery || undefined,
                      });
                      onSync(result);
                      setKeySaved(result.recoverySaved);
                      setToken("");
                      setRecovery("");
                      setShownKey(await api().syncKey());
                      onMessage("Репозиторий подключён. Сохраните ключ восстановления.");
                    })
                  }
                >
                  {busy
                    ? "Подключение…"
                    : sync.configured
                      ? "Обновить подключение"
                      : "Подключить"}
                </button>
                {sync.configured && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        setShownKey(await api().syncKey());
                      })
                    }
                  >
                    <KeyRound size={15} />
                    Показать ключ
                  </button>
                )}
              </div>
              {shownKey && (
                <div className="recovery-card">
                  <strong>Сохраните ключ отдельно от репозитория</strong>
                  <textarea aria-label="Ключ восстановления" readOnly value={shownKey} />
                  <button
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(shownKey);
                        onMessage("Ключ скопирован");
                      })
                    }
                  >
                    <Copy size={14} />
                    Копировать ключ
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={keySaved}
                      onChange={(e) => {
                        const saved = e.target.checked;
                        setKeySaved(saved);
                        if (saved)
                          run(async () => onSync(await api().syncConfirmRecovery()));
                      }}
                    />
                    Я сохранил ключ восстановления
                  </label>
                  <small>
                    При потере всех устройств и ключа восстановить зашифрованные заметки
                    невозможно.
                  </small>
                </div>
              )}
              {sync.configured && (
                <>
                  <div className="setting-row">
                    <div>
                      <strong>Подключено: {sync.account}</strong>
                      <small>
                        {sync.lastSync
                          ? "Последний обмен: " +
                            new Date(sync.lastSync).toLocaleString("ru-RU")
                          : "Первый обмен ещё не выполнен"}
                      </small>
                    </div>
                    <button
                      disabled={busy || (!!shownKey && !keySaved)}
                      onClick={() =>
                        run(async () => {
                          const result = await api().syncNow();
                          onSync(await api().syncStatus());
                          onMessage(
                            `Отправлено: ${result.uploaded}, получено: ${result.downloaded}${result.conflicts.length ? ", конфликтов: " + result.conflicts.length : ""}`,
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Обмен сейчас
                    </button>
                  </div>
                  <Toggle
                    label="Автоматическая синхронизация"
                    description="Каждые 5 минут при запущенном приложении. Включайте после сохранения ключа."
                    checked={preferences.autoSync}
                    onChange={(v) => update({ autoSync: v })}
                  />
                  <button
                    className="danger-text"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api().syncDisconnect();
                        onSync(await api().syncStatus());
                        setShownKey("");
                        onMessage(
                          "Устройство отключено. Локальные файлы и репозиторий сохранены.",
                        );
                      })
                    }
                  >
                    <LogOut size={14} />
                    Отключить это устройство
                  </button>
                </>
              )}
            </>
          )}
          {tab === "plugins" && (
            <>
              <h2>Расширения</h2>
              <p className="muted">
                Команды Veltrite из JSON-манифестов. JavaScript-расширения не
                поддерживаются.
              </p>
              <button
                onClick={() =>
                  run(async () => {
                    const plugin = await api().installPlugin();
                    if (plugin) {
                      setPlugins(await api().plugins());
                      onMessage("Расширение добавлено и пока выключено");
                    }
                  })
                }
              >
                <Puzzle size={16} />
                Установить расширение…
              </button>
              {plugins.map((plugin) => (
                <Toggle
                  key={plugin.id}
                  label={`${plugin.name} · ${plugin.version}`}
                  description={plugin.description}
                  checked={plugin.enabled}
                  onChange={(enabled) =>
                    run(async () => {
                      await api().togglePlugin(plugin.id, enabled);
                      setPlugins(await api().plugins());
                    })
                  }
                />
              ))}
              {!plugins.length && (
                <div className="empty-small">
                  Дополнительных расширений пока нет. Основные инструменты уже встроены.
                </div>
              )}
            </>
          )}
          {tab === "about" && (
            <>
              <BrandMark size={40} />
              <h2>О приложении</h2>
              <p>Veltrite</p>
              <p className="muted">Заметки, холсты и базы в локальной папке.</p>
              <div className="info-card">
                Обычные Markdown-файлы, открытый формат холстов JSON Canvas, локальная
                работа и ваш собственный GitHub-репозиторий.
              </div>
              <div className="setting-row">
                <div>
                  <strong>Версия 0.2.1</strong>
                  <small>macOS · Windows</small>
                </div>
                <button
                  onClick={() =>
                    run(async () => {
                      const update = await api().checkUpdate();
                      if (!update)
                        onMessage(
                          "Для этой сборки не задан публичный репозиторий обновлений. Новую версию можно скачать в GitHub Releases.",
                        );
                      else if (update.available) {
                        await api().installUpdate();
                      } else onMessage("Установлена последняя версия");
                    })
                  }
                >
                  Проверить обновления
                </button>
              </div>
              <p className="field-help">
                Ранняя версия. Поддерживаются расширения из JSON-манифестов и основные
                операции с файлами .canvas и .base.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="setting-row toggle-row">
      <div>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
