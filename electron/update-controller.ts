import { compareVersions, type UpdateState } from "../shared/updates";
export interface UpdateDriver {
  check(): Promise<{ version: string }>;
  download(): Promise<unknown>;
  install(silent: boolean, relaunch: boolean): void;
  progress(callback: (percent: number) => void): () => void;
  errors?(callback: (error: Error) => void): () => void;
}
interface Options {
  version: string;
  url: string;
  driver: UpdateDriver | null;
  manualCheck: () => Promise<string>;
  changed: (state: UpdateState) => void;
  openManual: () => Promise<void>;
}
/** Tracks an explicit check → download → restart flow without installing on app quit. */
export class UpdateController {
  private value: UpdateState;
  private pending: Promise<UpdateState> | null = null;
  constructor(private options: Options) {
    this.value = {
      phase: "idle",
      version: null,
      progress: 0,
      automatic: !!options.driver,
      url: options.url,
      error: null,
    };
    options.driver?.errors?.((error) =>
      this.set({ phase: "error", error: error.message }),
    );
    options.driver?.progress((percent) => {
      if (this.value.phase === "downloading")
        this.set({ progress: Math.max(0, Math.min(100, percent)) });
    });
  }
  state() {
    return { ...this.value };
  }
  private set(patch: Partial<UpdateState>) {
    this.value = { ...this.value, ...patch };
    this.options.changed(this.state());
    return this.state();
  }
  private task(action: () => Promise<UpdateState>) {
    if (this.pending) return this.pending;
    const pending = action()
      .catch((error: unknown) =>
        this.set({
          phase: "error",
          error:
            error instanceof Error
              ? /checksum mismatch/i.test(error.message)
                ? "Контрольная сумма обновления не совпала. Повторите проверку."
                : error.message
              : "Не удалось обновить приложение",
        }),
      )
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
  check(): Promise<UpdateState> {
    if (["downloading", "ready"].includes(this.value.phase))
      return Promise.resolve(this.state());
    return this.task(async () => {
      this.set({ phase: "checking", error: null, progress: 0 });
      const version = this.options.driver
        ? (await this.options.driver.check()).version
        : await this.options.manualCheck();
      return this.set({
        version,
        phase:
          compareVersions(version, this.options.version) > 0 ? "available" : "current",
      });
    });
  }
  download(): Promise<UpdateState> {
    if (this.value.phase === "downloading" && this.pending) return this.pending;
    if (!this.options.driver)
      return Promise.reject(new Error("Для этой сборки доступна ручная установка"));
    if (this.value.phase !== "available")
      return Promise.reject(new Error("Сначала проверьте наличие новой версии"));
    return this.task(async () => {
      this.set({ phase: "downloading", error: null, progress: 0 });
      await this.options.driver!.download();
      return this.set({ phase: "ready", progress: 100 });
    });
  }
  async install(silent = false, relaunch = true) {
    if (!this.options.driver) {
      if (this.value.phase !== "available")
        throw Error("Сначала проверьте наличие новой версии");
      await this.options.openManual();
      return;
    }
    if (this.value.phase !== "ready") throw Error("Сначала загрузите обновление");
    this.options.driver.install(silent, relaunch);
  }
}
