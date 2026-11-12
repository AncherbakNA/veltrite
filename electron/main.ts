import {
  app,
  BrowserWindow,
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
import type { Preferences, SyncStatus } from "../shared/types";
import { ConfigStore } from "./config";
import { newRecoveryKey, parseRecoveryKey } from "./crypto";
import { exportSite, type StaticPage } from "./export-site";
import { beginDeviceLogin, finishDeviceLogin, GitHub } from "./github";
import { importObsidian } from "./importer";
import { safePath } from "./paths";
import { Plugins } from "./plugins";
import { synchronize, type SyncCheckpoint } from "./sync";
import { atomicWrite, hash, MAX_FILE, Serial, Vault } from "./vault";
const CLIENT_ID = process.env.VELTRITE_GITHUB_CLIENT_ID || "";
const RELEASE_REPOSITORY = process.env.VELTRITE_RELEASE_REPOSITORY || "";
const testMode = process.env.VELTRITE_TEST_MODE === "1";
if (testMode) {
  if (!process.env.VELTRITE_TEST_DATA || !path.isAbsolute(process.env.VELTRITE_TEST_DATA))
    throw Error("Для тестов необходим отдельный абсолютный путь");
  app.setPath("userData", process.env.VELTRITE_TEST_DATA);
}
protocol.registerSchemesAsPrivileged([
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
let vault: Vault | null = null;
let watcher: FSWatcher | null = null;
let changeTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
const serial = new Serial();
let store: ConfigStore, plugins: Plugins;
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
function notify() {
  if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send("vault:changed");
}
async function openVault(root: string) {
  const next = new Vault(root);
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
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(notify, 180);
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
  importObsidian: async () => {
    const source = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите хранилище Obsidian",
      properties: ["openDirectory"],
    });
    if (source.canceled) return null;
    const destination = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите пустую папку для копии",
      properties: ["openDirectory", "createDirectory"],
    });
    if (destination.canceled) return null;
    return serial.run(async () => {
      const result = await importObsidian(source.filePaths[0], destination.filePaths[0]);
      result.vault = await openVault(destination.filePaths[0]);
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
        let rel = current.preferences.attachmentFolder + "/" + filename,
          i = 2;
        while (
          (await current.list()).some((f) => f.path.toLowerCase() === rel.toLowerCase())
        )
          rel = current.preferences.attachmentFolder + "/" + stem + " " + i++ + ext;
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
      const rel =
        needVault().preferences.attachmentFolder +
        "/Запись " +
        new Date().toISOString().replace(/[:.]/g, "-") +
        ".webm";
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
      notify();
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
    await atomicWrite(result.filePath, html);
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
  checkUpdate: async () => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(RELEASE_REPOSITORY)) return null;
    const response = await fetch(
      "https://api.github.com/repos/" + RELEASE_REPOSITORY + "/releases/latest",
      {
        headers: { Accept: "application/vnd.github+json" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw Error("Не удалось проверить обновление");
    const data = (await response.json()) as any;
    const version = String(data.tag_name || "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Некорректная версия обновления");
    return {
      version,
      url: "https://github.com/" + RELEASE_REPOSITORY + "/releases/latest",
      available:
        version.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0,
    };
  },
  installUpdate: async () => {
    if (!RELEASE_REPOSITORY) throw Error("Репозиторий релизов ещё не настроен");
    await shell.openExternal(
      "https://github.com/" + RELEASE_REPOSITORY + "/releases/latest",
    );
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
  plugins: () => plugins.list(),
  installPlugin: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Установить расширение Veltrite",
      properties: ["openFile"],
      filters: [{ name: "Манифест Veltrite", extensions: ["json"] }],
    });
    if (result.canceled) return null;
    return plugins.install(result.filePaths[0]);
  },
  togglePlugin: (id: string, enabled: boolean) => plugins.toggle(id, enabled),
  workspaceSave: async (
    name: string,
    data: { tabs: string[]; active: string | null },
  ) => {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      !Array.isArray(data.tabs) ||
      data.tabs.some((t) => typeof t !== "string")
    )
      throw Error("Некорректное рабочее пространство");
    const key = "workspaces-" + secretId();
    const all = await store.readLocal<any[]>(key, []);
    await store.writeLocal(
      key,
      [
        { name: name.trim(), tabs: data.tabs, active: data.active },
        ...all.filter((w) => w.name !== name),
      ].slice(0, 20),
    );
  },
  saveSession: async (data: { tabs: string[]; active: string | null }) => {
    const current = needVault();
    if (
      !Array.isArray(data.tabs) ||
      data.tabs.length > 100 ||
      data.tabs.some((p) => typeof p !== "string")
    )
      throw Error("Некорректный список вкладок");
    const files = await current.list();
    const paths = data.tabs.filter((p) =>
      files.some((f) => f.path === p && ["note", "canvas", "base"].includes(f.kind)),
    );
    await store.writeLocal("session-" + secretId(), {
      tabs: paths,
      active: data.active && paths.includes(data.active) ? data.active : null,
    });
  },
  workspaces: () => store.readLocal("workspaces-" + secretId(), []),
};
function setupIpc() {
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
    height: 930,
    minWidth: 940,
    minHeight: 640,
    title: "Veltrite",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(__dirname, "../resources/icon.png"),
    backgroundColor: "#161b24",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(pathToFileURL(path.join(__dirname, "../dist/")).href))
      event.preventDefault();
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === "media" && !testMode),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission) => permission === "media" && !testMode,
  );
  await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  mainWindow.on("close", (event) => {
    if (testMode) return;
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
    setupIpc();
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
                  accelerator: "CmdOrCtrl+,",
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
            accelerator: "CmdOrCtrl+N",
            click: () => emit("new-note"),
          },
          { label: "Новый холст", click: () => emit("new-canvas") },
          { label: "Открыть хранилище…", click: () => emit("open-vault") },
          { label: "Импорт из Obsidian…", click: () => emit("import") },
          { type: "separator" },
          { label: "Экспорт PDF…", click: () => emit("pdf") },
          {
            label: "Синхронизировать",
            accelerator: "CmdOrCtrl+Shift+S",
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
            accelerator: "CmdOrCtrl+P",
            click: () => emit("commands"),
          },
          {
            label: "Быстрый переход",
            accelerator: "CmdOrCtrl+O",
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
tags: [начало]
---
# Место для ваших мыслей

Добро пожаловать в **Veltrite**. Заметки живут в обычной папке на вашем компьютере.

## Начните с идеи

- Создайте заметку: **⌘/Ctrl + N**
- Найдите команду: **⌘/Ctrl + P**
- Перейдите к заметке: **⌘/Ctrl + O**
- Свяжите мысли через \`[[название заметки]]\`
- Откройте **холст**, чтобы разложить идеи в пространстве

> [!tip] Всё под вашим контролем
> Можно открыть готовую папку Obsidian или импортировать её копию.

## План на сегодня

- [ ] Записать первую мысль
- [ ] Создать связь между заметками
- [ ] Подключить приватный репозиторий в настройках

$$
E = mc^2
$$
`;
