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
import { useEffect, useState } from "react";
import type { PluginInfo, Preferences, SyncStatus } from "../../shared/types";
import { api } from "../useVault";
export default function Settings({
  preferences,
  sync,
  onPreferences,
  onSync,
  onClose,
  onError,
  onMessage,
}: {
  preferences: Preferences;
  sync: SyncStatus;
  onPreferences: (p: Preferences) => void;
  onSync: (s: SyncStatus) => void;
  onClose: () => void;
  onError: (m: string) => void;
  onMessage: (m: string) => void;
}) {
  const [tab, setTab] = useState("appearance"),
    [repository, setRepository] = useState(sync.repository),
    [token, setToken] = useState(""),
    [recovery, setRecovery] = useState(""),
    [shownKey, setShownKey] = useState(""),
    [keySaved, setKeySaved] = useState(sync.recoverySaved),
    [busy, setBusy] = useState(false),
    [device, setDevice] = useState(""),
    [plugins, setPlugins] = useState<PluginInfo[]>([]);
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
      <div className="modal settings-modal" role="dialog" aria-label="Настройки">
        <nav className="settings-nav">
          <span className="eyebrow">НАСТРОЙКИ</span>
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
          <div className="settings-brand">
            <span className="logo-small">V</span>
            <strong>Veltrite</strong>
            <small>Ваши мысли. Ваши файлы.</small>
          </div>
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
              <h2>Ваше пространство</h2>
              <p className="muted">Настройте Veltrite под себя.</p>
              <div className="setting-row">
                <div>
                  <strong>Цветовая тема</strong>
                  <small>Комфортная работа в любое время</small>
                </div>
                <select
                  aria-label="Цветовая тема"
                  value={preferences.theme}
                  onChange={(e) => update({ theme: e.target.value as any })}
                >
                  <option value="dark">Тёмная</option>
                  <option value="light">Светлая</option>
                  <option value="system">Системная</option>
                </select>
              </div>
              <div className="setting-row">
                <div>
                  <strong>Акцентный цвет</strong>
                  <small>Ссылки, кнопки и выделение</small>
                </div>
                <input
                  aria-label="Акцентный цвет"
                  type="color"
                  value={preferences.accent}
                  onChange={(e) => update({ accent: e.target.value })}
                />
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
              <h2>Редактор и файлы</h2>
              <p className="muted">Изменения заметок сохраняются автоматически.</p>
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
                Команды Veltrite из JSON-манифестов. JavaScript-плагины Obsidian требуют
                отдельной совместимости и здесь не запускаются.
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
              <div className="about-logo">V</div>
              <h2>Veltrite</h2>
              <p className="muted">Пространство для мыслей и связей.</p>
              <div className="info-card">
                Обычные Markdown-файлы, открытый формат холстов JSON Canvas, локальная
                работа и ваш собственный GitHub-репозиторий.
              </div>
              <div className="setting-row">
                <div>
                  <strong>Версия 0.1.0</strong>
                  <small>macOS · Windows</small>
                </div>
                <button
                  onClick={() =>
                    run(async () => {
                      const update = await api().checkUpdate();
                      if (!update)
                        onMessage("Репозиторий релизов будет настроен при публикации");
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
                Veltrite — самостоятельное приложение. Это ранняя версия: полный API и все
                расширенные режимы Obsidian пока не воспроизведены.
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
