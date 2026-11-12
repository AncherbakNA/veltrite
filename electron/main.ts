import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { EditorContext, PluginPermission } from "../shared/extensions";
import { folderFile } from "../shared/links";
import { normalizeSession, type WorkspaceSession } from "../shared/panes";
import type { Preferences, SyncStatus } from "../shared/types";
import { Catalog } from "./catalog";
import { composeNotes } from "./composer";
import { ConfigStore } from "./config";
import { newRecoveryKey, parseRecoveryKey } from "./crypto";
import { standaloneHtml } from "./export-html";
import { exportSite, type StaticPage } from "./export-site";
import { beginDeviceLogin, finishDeviceLogin, GitHub } from "./github";
import { importFolder } from "./importer";
import { linkMention, unlinkedMentions } from "./mentions";
import { updateProperties } from "./metadata";
import { safePath } from "./paths";
import { PluginActions } from "./plugin-actions";
import { pluginPreload, PluginRuntime } from "./plugin-runtime";
import { Plugins } from "./plugins";
import { StyleStore } from "./styles";
import { synchronize, type SyncCheckpoint } from "./sync";
import type { UpdateController } from "./update-controller";
import { createUpdates } from "./updates";
import { atomicWrite, hash, MAX_FILE, Serial, Vault } from "./vault";
import { WebCards, type CardBounds } from "./web-cards";
const CLIENT_ID = process.env.VELTRITE_GITHUB_CLIENT_ID || "";
const RELEASE_REPOSITORY =
  process.env.VELTRITE_RELEASE_REPOSITORY || "AncherbakNA/veltrite";
const testMode = process.env.VELTRITE_TEST_MODE === "1";
if (testMode) {
  if (!process.env.VELTRITE_TEST_DATA || !path.isAbsolute(process.env.VELTRITE_TEST_DATA))
    throw Error("Для тестов необходим отдельный абсолютный путь");
  app.setPath("userData", process.env.VELTRITE_TEST_DATA);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: "veltrite-plugin",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "veltrite-map",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  {
    scheme: "veltrite-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
app.setName("Veltrite");
if (process.platform === "win32") app.setAppUserModelId("app.veltrite.desktop");
let mainWindow: BrowserWindow;
let webCards: WebCards;
let updates: UpdateController;
let installingUpdate = false;
let pluginRuntime: PluginRuntime | null = null;
let editorContext: EditorContext = {
  path: null,
  content: "",
  selection: "",
  paneId: "main",
};
let vault: Vault | null = null;
let watcher: FSWatcher | null = null;
let changeTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
const serial = new Serial();
let store: ConfigStore, plugins: Plugins, catalog: Catalog;
let mentionsController: AbortController | null = null;
let syncBusy = false;
let syncError: string | null = null;
let login: Awaited<ReturnType<typeof beginDeviceLogin>> | null = null;
let loginAbort: AbortController | null = null;
let pendingToken: string | null = null;
interface SyncConnection {
  recoverySaved: boolean;
  repository: string;
  token: string;
  key: string;
  repositoryId: number;
  account: string;
  lastSync: string | null;
}
const needVault = () => {
  if (!vault) throw Error("Сначала откройте хранилище");
  return vault;
};
const secretId = () => hash(needVault().root);
async function connection() {
  return store.readSecret<SyncConnection>("sync-" + secretId());
}
async function status(): Promise<SyncStatus> {
  let cfg: SyncConnection | null = null;
  try {
    cfg = vault ? await connection() : null;
  } catch (error) {
    syncError = error instanceof Error ? error.message : "Нужно восстановить вход GitHub";
  }
  return {
    configured: !!cfg,
    repository: cfg?.repository || "",
    account: cfg?.account || "",
    encrypted: true,
    lastSync: cfg?.lastSync || null,
    busy: syncBusy,
    hasKey: !!cfg?.key,
    recoverySaved: cfg?.recoverySaved || false,
    error: syncError,
    deviceFlowAvailable: !!CLIENT_ID,
  };
}
function notify(reason: "files" | "settings" = "files") {
  if (reason === "files") {
    pluginRuntime?.emit("vault:changed", null);
    pluginRuntime?.emit("metadata:changed", null);
  }
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("vault:changed", reason);
}
async function openVault(root: string) {
  editorContext = { path: null, content: "", selection: "", paneId: "main" };
  const next = new Vault(root, path.join(__dirname, "search-worker.cjs"));
  await next.open();
  vault = next;
  syncError = null;
  const config = await store.read();
  config.lastVault = next.root;
  config.recent = [
    { root: next.root, name: path.basename(next.root) },
    ...config.recent.filter((r) => r.root !== next.root),
  ].slice(0, 12);
  await store.write(config);
  watcher?.close();
  watcher = watch(next.root, { recursive: true }, (_event, name) => {
    if (
      !name ||
      String(name)
        .split(path.sep)
        .some((p) => p.startsWith("."))
    )
      return;
    next.invalidate(String(name).split(path.sep).join("/"));
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => notify("files"), 180);
  });
  watcher.on("error", () => notify());
  configureTimer();
  notify();
  return next.info();
}
function configureTimer() {
  if (syncTimer) clearInterval(syncTimer);
  if (vault?.preferences.autoSync)
    syncTimer = setInterval(
      () => {
        if (!syncBusy) serial.run(syncNow).catch(() => {});
      },
      Math.max(60, vault.preferences.syncInterval) * 1000,
    );
}
async function syncNow() {
  const current = needVault(),
    id = secretId(),
    cfg = await connection();
  if (!cfg) throw Error("Подключите приватный репозиторий в настройках");
  if (!cfg.recoverySaved)
    throw Error(
      "Сначала сохраните ключ восстановления и подтвердите это в настройках GitHub Sync",
    );
  if (syncBusy) throw Error("Синхронизация уже выполняется");
  syncBusy = true;
  notify();
  try {
    const checkpoint = await store.readLocal<SyncCheckpoint | null>(
      "checkpoint-" + id,
      null,
    );
    const result = await synchronize(
      current,
      new GitHub(cfg.repository, cfg.token),
      cfg.key,
      checkpoint,
      async (next) => store.writeLocal("checkpoint-" + id, next),
      cfg.repositoryId,
    );
    cfg.lastSync = result.at;
    syncError = null;
    await store.saveSecret("sync-" + id, cfg);
    configureTimer();
    notify();
    return result;
  } catch (error) {
    syncError = error instanceof Error ? error.message : "Ошибка синхронизации";
    throw error;
  } finally {
    syncBusy = false;
    notify();
  }
}
const attachmentTypes = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".pdf",
  ".mp3",
  ".wav",
  ".ogg",
  ".webm",
  ".mp4",
  ".m4a",
  ".mov",
  ".flac",
]);
const styleStore = () => new StyleStore(path.join(app.getPath("userData"), "styles"));
const methods: Record<string, (...args: any[]) => any> = {
  state: async () => ({
    session: vault ? await store.readLocal("session-" + secretId(), null) : null,
    version: app.getVersion(),
    recent: (await store.read()).recent,
    vault: vault ? await vault.info() : null,
    sync: await status(),
  }),
  chooseVault: async (create: boolean) => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: create
        ? "Создать хранилище: выберите или создайте папку"
        : "Открыть хранилище Markdown",
      properties: ["openDirectory", "createDirectory"],
    });
    if (choice.canceled) return null;
    return serial.run(async () => {
      const info = await openVault(choice.filePaths[0]);
      if (create && info.files.length === 0) {
        await needVault().create("Добро пожаловать.md", welcomeNote);
        return needVault().info();
      }
      return info;
    });
  },
  openRecent: async (root: string) => {
    if (!(await store.read()).recent.some((r) => r.root === root))
      throw Error("Эта папка не была открыта пользователем");
    return serial.run(() => openVault(root));
  },
  importFolder: async () => {
    const source = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите папку для импорта",
      properties: ["openDirectory"],
    });
    if (source.canceled) return null;
    const destination = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите пустую папку для копии",
      properties: ["openDirectory", "createDirectory"],
    });
    if (destination.canceled) return null;
    return serial.run(async () => {
      const result = await importFolder(
        source.filePaths[0],
        destination.filePaths[0],
        styleStore(),
      );
      result.vault = await openVault(destination.filePaths[0]);
      if (result.session) await store.writeLocal("session-" + secretId(), result.session);
      if (result.workspaces?.length)
        await store.writeLocal("workspaces-" + secretId(), result.workspaces);
      return result;
    });
  },
  refresh: () => needVault().list(),
  read: (rel: string) => needVault().read(rel),
  write: (rel: string, text: string, revision?: string) =>
    serial.run(async () => {
      const result = await needVault().write(rel, text, revision);
      notify();
      return result;
    }),
  create: (rel: string, text = "") =>
    serial.run(async () => {
      const result = await needVault().create(rel, text);
      notify();
      return result;
    }),
  updateProperties: (
    paths: string[],
    change: import("../shared/frontmatter-edit").PropertyChange,
  ) =>
    serial.run(async () => {
      const result = await updateProperties(needVault(), paths, change);
      notify();
      return result;
    }),
  compose: (request: import("../shared/composer").ComposeRequest) =>
    serial.run(async () => {
      const result = await composeNotes(needVault(), request);
      notify();
      return result;
    }),
  mkdir: (rel: string) =>
    serial.run(async () => {
      await needVault().mkdir(rel);
      notify();
    }),
  rename: (rel: string, to: string) =>
    serial.run(async () => {
      await needVault().rename(rel, to);
      notify();
    }),
  trash: (rel: string) =>
    serial.run(async () => {
      await needVault().trash(rel);
      notify();
    }),
  trashList: () => needVault().trashList(),
  restoreTrash: (id: string) =>
    serial.run(async () => {
      await needVault().restoreTrash(id);
      notify();
    }),
  history: (rel: string) => needVault().history(rel),
  historyRead: (rel: string, id: string) => needVault().historyRead(rel, id),
  historyRestore: (rel: string, id: string) =>
    serial.run(async () => {
      const current = await needVault().read(rel);
      await needVault().write(
        rel,
        await needVault().historyRead(rel, id),
        current.revision,
      );
      notify();
    }),
  search: (query: string) => needVault().search(query),
  index: () => needVault().index(),
  mentions: (path: string) => {
    mentionsController?.abort();
    const controller = new AbortController();
    mentionsController = controller;
    return unlinkedMentions(needVault(), path, controller.signal).finally(() => {
      if (mentionsController === controller) mentionsController = null;
    });
  },
  linkMention: (mention: import("../shared/mentions").UnlinkedMention) =>
    serial.run(async () => {
      const result = await linkMention(needVault(), mention);
      notify();
      return result;
    }),
  importAttachments: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Добавить вложения",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Изображения, PDF, аудио и видео",
          extensions: [...attachmentTypes].map((e) => e.slice(1)),
        },
      ],
    });
    if (result.canceled) return [];
    return serial.run(async () => {
      const current = needVault(),
        added: string[] = [];
      for (const source of result.filePaths) {
        const stat = await fs.lstat(source);
        if (
          stat.isSymbolicLink() ||
          !stat.isFile() ||
          stat.size > MAX_FILE ||
          !attachmentTypes.has(path.extname(source).toLowerCase())
        )
          throw Error("Неподдерживаемое вложение или размер больше 32 МиБ");
        const filename = path.basename(source),
          ext = path.extname(filename),
          stem = filename.slice(0, filename.length - ext.length);
        let rel = folderFile(
            current.preferences.attachmentFolder,
            filename,
            editorContext.path || "",
          ),
          i = 2;
        while (
          (await current.list()).some((f) => f.path.toLowerCase() === rel.toLowerCase())
        )
          rel = folderFile(
            current.preferences.attachmentFolder,
            stem + " " + i++ + ext,
            editorContext.path || "",
          );
        await atomicWrite(await safePath(current.root, rel), await fs.readFile(source));
        added.push(rel);
      }
      notify();
      return added;
    });
  },
  saveAudio: (bytes: number[]) =>
    serial.run(async () => {
      if (
        !Array.isArray(bytes) ||
        bytes.length > MAX_FILE ||
        bytes.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
      )
        throw Error("Некорректная аудиозапись");
      const rel = folderFile(
        needVault().preferences.attachmentFolder,
        "Запись " + new Date().toISOString().replace(/[:.]/g, "-") + ".webm",
        editorContext.path || "",
      );
      await atomicWrite(await safePath(needVault().root, rel), Buffer.from(bytes));
      notify();
      return rel;
    }),
  preferences: (patch: Partial<Preferences>) =>
    serial.run(async () => {
      if (patch.autoSync === true && !(await connection())?.recoverySaved)
        throw Error("Подключите GitHub и подтвердите сохранение ключа восстановления");
      const next = await needVault().setPreferences(patch);
      configureTimer();
      notify("settings");
      return next;
    }),
  exportVault: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Экспорт: выберите пустую папку",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return false;
    const to = await fs.realpath(result.filePaths[0]),
      current = needVault();
    if (
      to === current.root ||
      to.startsWith(current.root + path.sep) ||
      current.root.startsWith(to + path.sep)
    )
      throw Error("Папка экспорта должна находиться вне хранилища");
    if ((await fs.readdir(to)).length) throw Error("Выберите пустую папку");
    for (const entry of await current.list()) {
      const target = await safePath(to, entry.path);
      if (entry.kind === "folder") await fs.mkdir(target, { recursive: true });
      else
        await atomicWrite(
          target,
          await fs.readFile(await safePath(current.root, entry.path)),
        );
    }
    return true;
  },
  exportHtml: async (rel: string, html: string) => {
    if (typeof html !== "string" || html.length > 16 * 1024 * 1024)
      throw Error("Документ слишком большой");
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Экспорт HTML",
      defaultPath: path.basename(rel, ".md") + ".html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await atomicWrite(
      result.filePath,
      await standaloneHtml(needVault(), html, path.join(__dirname, "../dist/assets")),
    );
    return true;
  },
  printPdf: async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Экспорт PDF",
      defaultPath: "Заметка.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const pdf = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    await atomicWrite(result.filePath, pdf);
    return true;
  },
  reveal: async (rel?: string) => {
    if (rel) shell.showItemInFolder(await safePath(needVault().root, rel));
    else await shell.openPath(needVault().root);
  },
  openExternal: async (url: string) => {
    if (typeof url !== "string" || url.length > 8192 || !/^https?:\/\//i.test(url))
      throw Error("Разрешены только ссылки HTTP и HTTPS");
    await shell.openExternal(url);
  },
  remoteImage: async (url: string) => {
    if (typeof url !== "string" || url.length > 8192 || !/^https?:\/\//i.test(url))
      throw Error("Некорректный адрес изображения");
    const parsed = new URL(url);
    if (parsed.username || parsed.password)
      throw Error("Адрес изображения не должен содержать пароль");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await net.fetch(url, {
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      const mime = (response.headers.get("content-type") || "")
        .split(";")[0]
        .toLowerCase();
      if (
        !response.ok ||
        ![
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "image/avif",
          "image/bmp",
          "image/svg+xml",
        ].includes(mime) ||
        !response.body
      )
        throw Error("Сервер не вернул изображение");
      const reader = response.body.getReader(),
        parts: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 12 * 1024 * 1024) {
          controller.abort();
          throw Error("Изображение больше 12 МиБ");
        }
        parts.push(chunk.value);
      }
      return "data:" + mime + ";base64," + Buffer.concat(parts).toString("base64");
    } catch (error: any) {
      if (controller.signal.aborted)
        throw Error("Загрузка изображения прервана: превышен размер или время ожидания");
      throw Error(
        error.message === "Сервер не вернул изображение"
          ? error.message
          : "Не удалось загрузить изображение",
      );
    } finally {
      clearTimeout(timer);
    }
  },
  copyText: (text: string) => {
    if (typeof text !== "string" || text.length > 1024 * 1024)
      throw Error("Слишком большой текст для буфера обмена");
    clipboard.writeText(text);
  },
  readAttachment: async (rel: string) => {
    if (!attachmentTypes.has(path.extname(rel).toLowerCase()))
      throw Error("Неподдерживаемый тип вложения");
    const file = await safePath(needVault().root, rel),
      stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw Error("Предпросмотр доступен для вложений до 64 МиБ");
    return new Uint8Array(await fs.readFile(file));
  },
  openAttachment: async (rel: string) => {
    if (!attachmentTypes.has(path.extname(rel).toLowerCase()))
      throw Error("Этот тип вложения нельзя открыть из приложения");
    const error = await shell.openPath(await safePath(needVault().root, rel));
    if (error) throw Error("Не удалось открыть вложение");
  },
  syncStatus: status,
  syncConnect: (options: { repository: string; token?: string; key?: string }) =>
    serial.run(async () => {
      let old: SyncConnection | null = null;
      try {
        old = await connection();
      } catch {}
      const token = options.token || pendingToken || old?.token || "";
      const github = new GitHub(options.repository, token),
        identity = await github.validate();
      let key = options.key || (old?.repository === options.repository ? old.key : "");
      const head = await github.head(identity.branch);
      if (
        !key &&
        head &&
        (await github.tree(head)).entries.some(
          (e) => e.path === "veltrite-sync/manifest.enc",
        )
      )
        throw Error("В репозитории уже есть хранилище. Введите его ключ восстановления.");
      key ||= newRecoveryKey();
      parseRecoveryKey(key);
      await store.saveSecret("sync-" + secretId(), {
        repository: options.repository,
        token,
        key,
        repositoryId: identity.id,
        account: identity.account,
        lastSync: old?.repository === options.repository ? old.lastSync : null,
        recoverySaved:
          !!options.key ||
          (old?.repository === options.repository && old.recoverySaved) ||
          false,
      } satisfies SyncConnection);
      if (old && old.repository !== options.repository)
        await store.writeLocal("checkpoint-" + secretId(), null);
      pendingToken = null;
      syncError = null;
      notify();
      return status();
    }),
  syncDisconnect: () =>
    serial.run(async () => {
      await store.removeSecret("sync-" + secretId());
      await store.writeLocal("checkpoint-" + secretId(), null);
      syncError = null;
      notify();
    }),
  syncKey: async () => {
    const cfg = await connection();
    if (!cfg) throw Error("Синхронизация не подключена");
    return cfg.key;
  },
  syncConfirmRecovery: () =>
    serial.run(async () => {
      const cfg = await connection();
      if (!cfg) throw Error("Сначала подключите репозиторий");
      cfg.recoverySaved = true;
      await store.saveSecret("sync-" + secretId(), cfg);
      notify();
      return status();
    }),
  syncNow: () => serial.run(syncNow),
  beginLogin: async () => {
    loginAbort?.abort();
    loginAbort = new AbortController();
    login = await beginDeviceLogin(CLIENT_ID);
    await shell.openExternal(login.verification_uri);
    return {
      userCode: login.user_code,
      verificationUri: login.verification_uri,
      expiresIn: login.expires_in,
    };
  },
  finishLogin: async () => {
    if (!login || !loginAbort) throw Error("Сначала начните вход");
    pendingToken = await finishDeviceLogin(CLIENT_ID, login, loginAbort.signal);
    login = null;
    return status();
  },
  cancelLogin: async () => {
    loginAbort?.abort();
    login = null;
    pendingToken = null;
  },
  updateState: () => updates.state(),
  checkUpdate: () => updates.check(),
  downloadUpdate: () => updates.download(),
  installUpdate: async () => {
    const state = updates.state();
    if (state.automatic) {
      if (state.phase !== "ready") throw Error("Сначала загрузите обновление");
      if (
        testMode &&
        (process.platform !== "win32" || process.env.VELTRITE_TEST_INSTALL_UPDATE !== "1")
      )
        throw Error("Установка обновлений в этом тестовом режиме отключена");
      await pluginRuntime?.close();
      webCards.closeAll();
      await serial.run(async () => {});
      for (const window of BrowserWindow.getAllWindows())
        if (window !== mainWindow) window.destroy();
      installingUpdate = true;
    }
    try {
      await updates.install(
        true,
        !(testMode && process.env.VELTRITE_TEST_NO_RELAUNCH === "1"),
      );
    } catch (error) {
      installingUpdate = false;
      throw error;
    }
  },
  publishSite: async (pages: StaticPage[]) => {
    const destination = await dialog.showOpenDialog(mainWindow, {
      title: "Экспорт сайта: выберите пустую папку",
      properties: ["openDirectory", "createDirectory"],
    });
    if (destination.canceled) return null;
    return exportSite(
      needVault(),
      pages,
      destination.filePaths[0],
      path.join(__dirname, "../dist/assets"),
    );
  },
  webCardOpen: (id: string, url: string) => webCards.open(id, url),
  webCardBounds: (id: string, bounds: CardBounds) => webCards.bounds(id, bounds),
  webCardClose: (id: string) => webCards.close(id),
  webViewer: async (url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url) || url.length > 8192)
      throw Error("Введите ссылку HTTP или HTTPS");
    const browser = new BrowserWindow({
      width: 1100,
      height: 800,
      title: "Веб-просмотр · Veltrite",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: "veltrite-isolated-web",
      },
    });
    browser.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, done) => done(false),
    );
    browser.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    browser.webContents.on("will-navigate", (event, target) => {
      if (!/^https?:\/\//i.test(target)) event.preventDefault();
    });
    browser.webContents.session.webRequest.onBeforeRequest(
      { urls: ["file://*/*", "veltrite-asset://*/*"] },
      (_details, done) => done({ cancel: true }),
    );
    await browser.loadURL(url);
  },
  catalog: (refresh = false) => catalog.list(!!refresh),
  catalogInstall: async (kind: "extension" | "theme", id: string) => {
    await catalog.install(kind, id);
    if (kind === "extension") {
      await pluginRuntime?.stop(id);
      mainWindow.webContents.send("plugins:changed");
    }
  },
  styles: () => styleStore().list(),
  installStyle: async (kind: "theme" | "snippet") => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === "theme" ? "Установить CSS-тему" : "Добавить CSS-сниппет",
      properties: ["openFile"],
      filters: [{ name: "CSS", extensions: ["css"] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 1024 * 1024)
      throw Error("CSS должен быть не больше 1 МиБ");
    return styleStore().install(
      path.basename(file),
      await fs.readFile(file, "utf8"),
      kind,
    );
  },
  saveStyle: (id: string, css: string) => styleStore().save(id, css),
  removeStyle: (id: string) => styleStore().remove(id),
  themes: () => catalog.themes(),
  installTheme: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Установить тему",
      properties: ["openFile"],
      filters: [{ name: "Палитра Veltrite", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const stat = await fs.stat(result.filePaths[0]);
    if (stat.size > 64 * 1024) throw Error("Файл темы больше 64 КиБ");
    return catalog.saveTheme(JSON.parse(await fs.readFile(result.filePaths[0], "utf8")));
  },
  removeTheme: (id: string) => catalog.removeTheme(id),
  plugins: async () =>
    (await plugins.list()).map((plugin) =>
      plugin.main
        ? {
            ...plugin,
            registeredCommands: pluginRuntime?.registeredCommands(plugin.id) || [],
            ui: pluginRuntime?.ui(plugin.id),
          }
        : plugin,
    ),
  installPlugin: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Установить расширение Veltrite",
      properties: ["openFile"],
      filters: [{ name: "Манифест Veltrite (manifest.json)", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    const plugin = await plugins.install(result.filePaths[0]);
    await pluginRuntime?.stop(plugin.id);
    mainWindow.webContents.send("plugins:changed");
    return plugin;
  },
  togglePlugin: async (id: string, enabled: boolean, grants: PluginPermission[] = []) => {
    if (!enabled) await pluginRuntime?.stop(id);
    const plugin = await plugins.toggle(id, enabled, grants);
    if (enabled && plugin.main)
      try {
        await pluginRuntime?.start(plugin);
      } catch (error: any) {
        await plugins.fail(id, error.message);
        throw error;
      }
    mainWindow.webContents.send("plugins:changed");
  },
  removePlugin: async (id: string) => {
    await pluginRuntime?.stop(id);
    await plugins.remove(id);
    mainWindow.webContents.send("plugins:changed");
  },
  executePlugin: (id: string, command: string) => pluginRuntime?.execute(id, command),
  updatePluginContext: (context: EditorContext) => {
    if (
      !context ||
      (context.path !== null &&
        (typeof context.path !== "string" || context.path.length > 2048)) ||
      typeof context.content !== "string" ||
      context.content.length > 1024 * 1024 ||
      typeof context.selection !== "string" ||
      context.selection.length > 1024 * 1024 ||
      typeof context.paneId !== "string" ||
      context.paneId.length > 80
    )
      throw Error("Некорректный контекст редактора");
    const workspaceChanged =
      editorContext.path !== context.path || editorContext.paneId !== context.paneId;
    editorContext = {
      path: context.path,
      content: context.content,
      selection: context.selection,
      paneId: context.paneId,
    };
    pluginRuntime?.emit("editor:changed", editorContext);
    if (workspaceChanged)
      pluginRuntime?.emit("workspace:changed", {
        path: editorContext.path,
        paneId: editorContext.paneId,
      });
  },
  workspaceSave: async (name: string, data: WorkspaceSession) => {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      !Array.isArray(data.tabs) ||
      data.tabs.some((t) => typeof t !== "string")
    )
      throw Error("Некорректное рабочее пространство");
    const normalized = normalizeSession(data);
    const key = "workspaces-" + secretId();
    const all = await store.readLocal<any[]>(key, []);
    await store.writeLocal(
      key,
      [{ name: name.trim(), ...normalized }, ...all.filter((w) => w.name !== name)].slice(
        0,
        20,
      ),
    );
  },
  saveSession: async (data: WorkspaceSession) => {
    const current = needVault();
    const files = await current.list();
    const allowed = new Set(
      files.filter((f) => ["note", "canvas", "base"].includes(f.kind)).map((f) => f.path),
    );
    await store.writeLocal("session-" + secretId(), normalizeSession(data, allowed));
  },
  workspaceRename: (from: string, to: string) =>
    serial.run(async () => {
      if (
        typeof from !== "string" ||
        typeof to !== "string" ||
        !to.trim() ||
        to.length > 100
      )
        throw Error("Некорректное название набора вкладок");
      const key = "workspaces-" + secretId(),
        all = await store.readLocal<any[]>(key, []);
      if (!all.some((entry) => entry.name === from))
        throw Error("Набор вкладок не найден");
      if (all.some((entry) => entry.name !== from && entry.name === to.trim()))
        throw Error("Такое название уже используется");
      await store.writeLocal(
        key,
        all.map((entry) => (entry.name === from ? { ...entry, name: to.trim() } : entry)),
      );
    }),
  workspaceDelete: (name: string) =>
    serial.run(async () => {
      if (typeof name !== "string") throw Error("Некорректное название набора вкладок");
      const key = "workspaces-" + secretId(),
        all = await store.readLocal<any[]>(key, []);
      await store.writeLocal(
        key,
        all.filter((entry) => entry.name !== name),
      );
    }),
  workspaces: () => store.readLocal("workspaces-" + secretId(), []),
};
function setupIpc() {
  ipcMain.handle("veltrite-plugin:invoke", (event, method, args) => {
    if (!pluginRuntime) throw Error("Расширения ещё не запущены");
    return pluginRuntime.invoke(event, method, args);
  });
  ipcMain.on("veltrite-plugin:reply", (event, id, error) =>
    pluginRuntime?.reply(event, id, error),
  );
  for (const [name, handler] of Object.entries(methods))
    ipcMain.handle("veltrite:" + name, async (event, ...args) => {
      if (
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      )
        throw Error("Недопустимый источник запроса");
      try {
        return await handler(...args);
      } catch (e) {
        throw Error(e instanceof Error ? e.message : "Не удалось выполнить действие");
      }
    });
}
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 640,
    title: "Veltrite",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(__dirname, "../resources/icon.png"),
    backgroundColor: "#1b1b1a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  webCards = new WebCards(mainWindow);
  updates = await createUpdates({
    repository: RELEASE_REPOSITORY,
    macSigned: process.env.VELTRITE_SIGNED_MAC === "1",
    testMode,
    changed: (state) => {
      if (state.phase === "error") installingUpdate = false;
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send("updates:state", state);
    },
  });
  const pluginActions = new PluginActions(mainWindow);
  const actionReply = (event: Electron.IpcMainEvent, id: unknown, error: unknown) =>
    pluginActions.reply(event, id, error);
  ipcMain.on("plugins:action-result", actionReply);
  pluginRuntime = new PluginRuntime(
    plugins,
    {
      vault: needVault,
      serial,
      changed: notify,
      context: () => editorContext,
      action: (action) => pluginActions.send(action),
      pluginsChanged: () => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send("plugins:changed");
      },
    },
    pluginPreload(__dirname),
  );
  mainWindow.once("closed", () => {
    ipcMain.removeListener("plugins:action-result", actionReply);
    pluginActions.close();
    void pluginRuntime?.close();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(pathToFileURL(path.join(__dirname, "../dist/")).href))
      event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "media" && !testMode && _contents === mainWindow.webContents),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      permission === "media" &&
      !testMode &&
      _contents === mainWindow.webContents &&
      origin.startsWith("file://"),
  );
  await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  void pluginRuntime.startEnabled().catch(() => {});
  mainWindow.on("close", (event) => {
    if (testMode || installingUpdate) return;
    event.preventDefault();
    mainWindow.webContents.send("app:menu", "request-close");
  });
  ipcMain.on("veltrite:close-ready", (event) => {
    if (event.sender === mainWindow.webContents) {
      mainWindow.removeAllListeners("close");
      mainWindow.close();
    }
  });
}
app
  .whenReady()
  .then(async () => {
    store = new ConfigStore(app.getPath("userData"));
    plugins = new Plugins(path.join(app.getPath("userData"), "plugins"));
    catalog = new Catalog(
      app.getPath("userData"),
      app.isPackaged
        ? path.join(process.resourcesPath, "catalog")
        : path.join(__dirname, "../catalog"),
      plugins,
    );
    setupIpc();
    protocol.handle("veltrite-map", async (request) => {
      const url = new URL(request.url),
        match = /^\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
      if (url.hostname !== "tile" || !match) return new Response(null, { status: 400 });
      const [z, x, y] = match.slice(1).map(Number);
      if (z > 18 || x >= 2 ** z || y >= 2 ** z)
        return new Response(null, { status: 400 });
      try {
        return await net.fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
          headers: {
            "User-Agent": `Veltrite/${app.getVersion()} (+https://github.com/AncherbakNA/veltrite)`,
          },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        return new Response(null, { status: 503 });
      }
    });
    protocol.handle("veltrite-asset", async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== "vault" || !vault)
          return new Response(null, { status: 404 });
        const relative = decodeURIComponent(url.pathname.slice(1));
        if (!attachmentTypes.has(path.extname(relative).toLowerCase()))
          return new Response(null, { status: 403 });
        const full = await safePath(vault.root, relative);
        return net.fetch(pathToFileURL(full).href);
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    const config = await store.read();
    if (testMode && process.env.VELTRITE_TEST_VAULT)
      await openVault(process.env.VELTRITE_TEST_VAULT);
    else if (config.lastVault)
      try {
        await openVault(config.lastVault);
      } catch {}
    const emit = (action: string) => mainWindow?.webContents.send("app:menu", action);
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin"
        ? [
            {
              label: "Veltrite",
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                {
                  label: "Настройки…",

                  click: () => emit("settings"),
                },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : []),
      {
        label: "Файл",
        submenu: [
          {
            label: "Новая заметка",

            click: () => emit("new-note"),
          },
          { label: "Новый холст", click: () => emit("new-canvas") },
          { label: "Открыть хранилище…", click: () => emit("open-vault") },
          { label: "Импорт из папки…", click: () => emit("import") },
          { type: "separator" },
          { label: "Экспорт PDF…", click: () => emit("pdf") },
          {
            label: "Синхронизировать",

            click: () => emit("sync"),
          },
        ],
      },
      {
        label: "Правка",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "Вид",
        submenu: [
          {
            label: "Палитра команд",

            click: () => emit("commands"),
          },
          {
            label: "Быстрый переход",

            click: () => emit("quick-open"),
          },
          { label: "Граф", click: () => emit("graph") },
          { role: "togglefullscreen" },
          ...(testMode ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Не удалось запустить Veltrite", String(error?.message || error));
    app.exit(1);
  });
app.on("window-all-closed", () => {
  watcher?.close();
  if (syncTimer) clearInterval(syncTimer);
  app.quit();
});
const welcomeNote = `---
tags: [справка]
---
# Начало

Заметки хранятся в выбранной папке как Markdown-файлы.

## Основные действия

- **⌘/Ctrl + N** — новая заметка
- **⌘/Ctrl + O** — перейти к файлу
- **⌘/Ctrl + P** — палитра команд
- **⌘/Ctrl + E** — правка и чтение

## Ссылки и файлы

Напишите \`[[Название заметки]]\`, чтобы создать ссылку. Вложения можно добавлять через палитру команд.

Для копирования готовой папки выберите **Импорт из папки** в меню хранилища.
`;
