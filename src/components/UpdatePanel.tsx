import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/updates";
import { api } from "../useVault";
export default function UpdatePanel({
  onInstall,
  onError,
}: {
  onInstall: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<UpdateState | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api()
      .updateState()
      .then((state) => {
        if (alive) setState(state);
      })
      .catch((error) => {
        if (alive) onError(error.message);
      });
    const off = api().onUpdateState(setState);
    return () => {
      alive = false;
      off();
    };
  }, [onError]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error: any) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="update-panel" aria-label="Обновления приложения">
      <div className="button-row">
        <button
          disabled={busy || state?.phase === "downloading"}
          onClick={() => void run(async () => setState(await api().checkUpdate()))}
        >
          {state?.phase === "checking" ? "Проверяем…" : "Проверить обновления"}
        </button>
        {state?.phase === "available" && (
          <button
            disabled={busy}
            className="primary"
            onClick={() =>
              void run(
                state.automatic
                  ? async () => setState(await api().downloadUpdate())
                  : onInstall,
              )
            }
          >
            {state.automatic ? "Загрузить " + state.version : "Скачать установщик"}
          </button>
        )}
        {state?.phase === "ready" && (
          <button disabled={busy} className="primary" onClick={() => void run(onInstall)}>
            Перезапустить и обновить
          </button>
        )}
      </div>
      {state?.phase === "current" && (
        <p className="muted" role="status">
          Установлена последняя версия
        </p>
      )}
      {state?.phase === "available" && (
        <p className="muted" role="status">
          Доступна версия {state.version}
        </p>
      )}
      {state?.phase === "downloading" && (
        <label className="update-progress">
          Загрузка: {Math.round(state.progress)}%
          <progress aria-label="Загрузка обновления" max={100} value={state.progress} />
        </label>
      )}
      {state?.phase === "ready" && (
        <p className="muted" role="status">
          Обновление загружено. Перед перезапуском заметки будут сохранены.
        </p>
      )}
      {state?.error && (
        <p role="alert" className="danger-text">
          {state.error}
        </p>
      )}
    </section>
  );
}
