import { app, shell } from "electron";
import { MacUpdater, NsisUpdater, type AppUpdater } from "electron-updater";
import type { AppAdapter } from "electron-updater/out/AppAdapter";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";
import fs from "node:fs/promises";
import path from "node:path";
import type { UpdateState } from "../shared/updates";
import { UpdateController, type UpdateDriver } from "./update-controller";
interface Options {
  repository: string;
  macSigned: boolean;
  testMode: boolean;
  changed: (state: UpdateState) => void;
}
/** Test feeds and caches are confined to the isolated test profile. */
class TestUpdater extends NsisUpdater {
  // electron-updater omits this test transport field from its public declarations.
  declare httpExecutor: ElectronHttpExecutor;
  constructor(url: string, adapter: AppAdapter) {
    super(null, adapter);
    this.httpExecutor = new ElectronHttpExecutor();
    this.setFeedURL({ provider: "generic", url, useMultipleRangeRequest: false });
  }
}
export async function createUpdates({
  repository,
  macSigned,
  testMode,
  changed,
}: Options) {
  const valid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);
  const url = valid ? `https://github.com/${repository}/releases/latest` : "";
  const testFeed = testMode ? process.env.VELTRITE_TEST_UPDATE_URL : undefined;
  let updater: AppUpdater | null = null;
  if (testFeed) {
    const parsed = new URL(testFeed);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
      parsed.protocol !== "http:"
    )
      throw Error("Тестовый сервер обновлений должен быть локальным HTTP-сервером");
    const directory = path.join(app.getPath("userData"), "update-test"),
      config = path.join(directory, "app-update.json");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      config,
      JSON.stringify({
        provider: "generic",
        url: testFeed,
        updaterCacheDirName: "updates",
        ...(process.env.VELTRITE_TEST_PUBLISHER_NAME
          ? { publisherName: process.env.VELTRITE_TEST_PUBLISHER_NAME }
          : {}),
      }),
    );
    const fixture = new TestUpdater(testFeed, {
      version: app.getVersion(),
      name: "Veltrite-test",
      isPackaged: true,
      appUpdateConfigPath: config,
      userDataPath: app.getPath("userData"),
      baseCachePath: directory,
      whenReady: () => app.whenReady(),
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
      onQuit: (handler) => app.once("quit", (_event, code) => handler(code)),
    });
    const installDirectory = process.env.VELTRITE_TEST_INSTALL_DIRECTORY;
    if (installDirectory) {
      const relative = path.relative(
        path.dirname(app.getPath("userData")),
        installDirectory,
      );
      if (
        !path.isAbsolute(installDirectory) ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      )
        throw Error(
          "Тестовая установка должна находиться рядом с изолированным профилем",
        );
      fixture.installDirectory = installDirectory;
    }
    updater = fixture;
  } else if (
    !testMode &&
    app.isPackaged &&
    valid &&
    (process.platform === "win32" || (process.platform === "darwin" && macSigned))
  ) {
    updater = process.platform === "win32" ? new NsisUpdater() : new MacUpdater();
  }
  let driver: UpdateDriver | null = null;
  if (updater) {
    const native = updater;
    native.autoDownload = false;
    native.autoInstallOnAppQuit = false;
    native.allowDowngrade = false;
    native.allowPrerelease = false;
    native.disableWebInstaller = true;
    native.disableDifferentialDownload = true;
    native.logger = null;
    driver = {
      check: async () => {
        const result = await native.checkForUpdates();
        if (!result) throw Error("Не удалось проверить обновление");
        return { version: result.updateInfo.version };
      },
      download: () => native.downloadUpdate(),
      install: (silent, relaunch) => native.quitAndInstall(silent, relaunch),
      errors: (callback) => {
        native.on("error", callback);
        return () => native.removeListener("error", callback);
      },
      progress: (callback) => {
        const listener = (info: { percent: number }) => callback(info.percent);
        native.on("download-progress", listener);
        return () => native.removeListener("download-progress", listener);
      },
    };
  }
  return new UpdateController({
    version: app.getVersion(),
    url,
    driver,
    changed,
    manualCheck: async () => {
      if (!valid) throw Error("Репозиторий обновлений не задан в этой сборке");
      const response = await fetch(
        `https://api.github.com/repos/${repository}/releases/latest`,
        {
          headers: { Accept: "application/vnd.github+json" },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error("Не удалось проверить обновление");
      const data = (await response.json()) as { tag_name?: unknown };
      return String(data.tag_name || "").replace(/^v/, "");
    },
    openManual: async () => {
      if (!valid) throw Error("Репозиторий обновлений не задан");
      await shell.openExternal(url);
    },
  });
}
