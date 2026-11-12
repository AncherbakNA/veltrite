import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  EditorContext,
  PluginAction,
  PluginPermission,
  PluginUI,
} from "../shared/extensions";
import { editFrontmatter } from "../shared/frontmatter-edit";
import type { PluginInfo } from "../shared/types";
import type { Plugins } from "./plugins";
import { Serial, type Vault } from "./vault";
interface Host {
  vault: () => Vault;
  serial: Serial;
  changed: () => void;
  context: () => EditorContext;
  action: (action: PluginAction) => Promise<void>;
  pluginsChanged: () => void;
}
interface Instance {
  plugin: PluginInfo;
  senderId: number;
  window: BrowserWindow;
  commands: Set<string>;
  events: Set<string>;
  stopping: boolean;
  active: boolean;
  activeRequests: number;
  rate: { start: number; count: number };
  ui: PluginUI;
  ready: Promise<void>;
  acceptReady: () => void;
  rejectReady: (error: Error) => void;
}
interface Pending {
  instance: Instance;
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
  reject: (error: Error) => void;
}
const string = (value: unknown, limit = 2048) => {
  if (typeof value !== "string" || value.length > limit)
    throw Error("Некорректный аргумент расширения");
  return value;
};
const bootstrap = `const api=window.veltritePlugin;import('./main.js').then(async module=>{if(typeof module.default!=='function')throw Error('Нужна функция export default activate(api)');const dispose=await module.default(api);if(typeof dispose==='function')api.onUnload(dispose);await api.ready();}).catch(error=>api.failed(String(error.message||error)));`;
/** Every extension runs in its own sandboxed renderer with a narrow capability bridge. */
export class PluginRuntime {
  private lifecycle = new Serial();
  private instances = new Map<string, Instance>();
  private senders = new Map<number, Instance>();
  private pending = new Map<string, Pending>();
  constructor(
    private plugins: Plugins,
    private host: Host,
    private preload: string,
  ) {}
  async startEnabled() {
    for (const plugin of await this.plugins.list())
      if (plugin.enabled && plugin.main)
        await this.start(plugin).catch(async (error) => {
          await this.plugins
            .fail(
              plugin.id,
              error instanceof Error ? error.message : "Не удалось запустить расширение",
            )
            .catch(() => {});
        });
  }
  start(plugin: PluginInfo) {
    return this.lifecycle.run(() => this.startNow(plugin));
  }
  private async startNow(plugin: PluginInfo) {
    if (!plugin.main || !plugin.enabled) return;
    await this.stopNow(plugin.id);
    if (this.instances.size >= 8)
      throw Error("Можно включить до восьми JavaScript-расширений одновременно");
    const code = await this.plugins.code(plugin.id);
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: "veltrite-plugin-" + randomUUID(),
        webSecurity: true,
      },
    });
    let acceptReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      acceptReady = resolve;
      rejectReady = reject;
    });
    const instance: Instance = {
      plugin,
      senderId: window.webContents.id,
      window,
      commands: new Set(),
      events: new Set(),
      stopping: false,
      active: false,
      activeRequests: 0,
      rate: { start: Date.now(), count: 0 },
      ui: { ribbon: [], status: null, settings: null },
      ready,
      acceptReady,
      rejectReady,
    };
    this.instances.set(plugin.id, instance);
    this.senders.set(window.webContents.id, instance);
    const contents = window.webContents,
      session = contents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-prevent-unload", (event) => event.preventDefault());
    session.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith(`veltrite-plugin://${plugin.id}/`) }),
    );
    const csp =
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
    session.protocol.handle("veltrite-plugin", (request) => {
      const url = new URL(request.url);
      if (url.hostname !== plugin.id || request.method !== "GET")
        return new Response(null, { status: 403 });
      const resources: Record<string, [string, string]> = {
        "/index.html": [
          '<!doctype html><meta charset="utf-8"><script type="module" src="./bootstrap.js"></script>',
          "text/html",
        ],
        "/bootstrap.js": [bootstrap, "application/javascript"],
        "/main.js": [code, "application/javascript"],
      };
      const resource = resources[url.pathname];
      return resource
        ? new Response(resource[0], {
            headers: {
              "Content-Type": resource[1] + "; charset=utf-8",
              "Content-Security-Policy": csp,
            },
          })
        : new Response(null, { status: 404 });
    });
    window.on("close", (event) => {
      if (!instance.stopping) {
        event.preventDefault();
        window.hide();
        contents.send("veltrite-plugin:event", "ui:closed", null);
      }
    });
    window.on("unresponsive", () => {
      if (!instance.stopping)
        void this.fail(instance, "Интерфейс расширения перестал отвечать").catch(
          () => {},
        );
    });
    contents.once("destroyed", () => {
      if (!instance.stopping)
        void this.fail(instance, "Расширение закрыло свой процесс").catch(() => {});
    });
    contents.on("render-process-gone", () => {
      if (!instance.stopping)
        void this.fail(instance, "Процесс расширения завершился").catch(() => {});
    });
    const timer = setTimeout(
      () => rejectReady(new Error("Расширение не запустилось за пять секунд")),
      5000,
    );
    try {
      await Promise.all([
        contents.loadURL(`veltrite-plugin://${plugin.id}/index.html`),
        ready,
      ]);
      this.host.pluginsChanged();
    } catch (error: unknown) {
      await this.fail(
        instance,
        error instanceof Error ? error.message : "Не удалось запустить расширение",
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  private permission(instance: Instance, permission: PluginPermission) {
    if (!instance.plugin.grants?.includes(permission))
      throw Error("Нет разрешения: " + permission);
  }
  private owner(sender: WebContents) {
    const instance = this.senders.get(sender.id);
    if (
      !instance ||
      instance.window.isDestroyed() ||
      instance.window.webContents !== sender
    )
      throw Error("Неизвестный источник расширения");
    return instance;
  }
  async invoke(
    event: IpcMainInvokeEvent,
    method: unknown,
    input: unknown,
  ): Promise<unknown> {
    const instance = this.owner(event.sender);
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !Array.isArray(input) ||
      input.length > 3
    )
      throw Error("Недопустимый запрос расширения");
    const now = Date.now();
    if (now - instance.rate.start >= 1000) instance.rate = { start: now, count: 0 };
    if (++instance.rate.count > 300 || instance.activeRequests >= 16)
      throw Error("Слишком много запросов расширения");
    instance.activeRequests++;
    try {
      return await this.dispatch(instance, method, input);
    } finally {
      instance.activeRequests--;
    }
  }
  ui(id: string): PluginUI | undefined {
    const instance = this.instances.get(id);
    return instance?.active && !instance.stopping ? instance.ui : undefined;
  }
  registeredCommands(id: string) {
    const instance = this.instances.get(id);
    return instance && instance.active && !instance.stopping
      ? [...instance.commands]
      : [];
  }
  private async dispatch(
    instance: Instance,
    method: unknown,
    args: unknown[],
  ): Promise<unknown> {
    if (instance.stopping && method !== "storage.set")
      throw Error("Расширение отключено");
    switch (method) {
      case "ready":
        instance.active = true;
        instance.acceptReady();
        return;
      case "failed":
        instance.rejectReady(new Error(string(args[0], 500)));
        return;
      case "commands.register": {
        const id = string(args[0], 80);
        if (!instance.plugin.commands.some((command) => command.id === id))
          throw Error("Команда не объявлена в манифесте");
        instance.commands.add(id);
        if (instance.active) this.host.pluginsChanged();
        return;
      }
      case "commands.unregister":
        instance.commands.delete(string(args[0], 80));
        if (instance.active) this.host.pluginsChanged();
        return;
      case "vault.list":
        this.permission(instance, "vault.read");
        return this.host.vault().list();
      case "vault.read":
        this.permission(instance, "vault.read");
        return this.host.vault().read(string(args[0]));
      case "vault.write": {
        this.permission(instance, "vault.write");
        const file = string(args[0]),
          content = string(args[1], 1024 * 1024),
          revision = string(args[2], 64);
        if (!/^[a-f0-9]{64}$/.test(revision))
          throw Error("Перед правкой прочитайте текущую ревизию файла");
        const vault = this.host.vault();
        return this.host.serial.run(async () => {
          if (instance.stopping || this.host.vault() !== vault)
            throw Error("Хранилище изменилось до выполнения правки");
          const result = await vault.write(file, content, revision);
          this.host.changed();
          return result;
        });
      }
      case "vault.create": {
        this.permission(instance, "vault.write");
        const file = string(args[0]),
          content = string(args[1], 1024 * 1024);
        const vault = this.host.vault();
        return this.host.serial.run(async () => {
          if (instance.stopping || this.host.vault() !== vault)
            throw Error("Хранилище изменилось до создания файла");
          const result = await vault.create(file, content);
          this.host.changed();
          return result;
        });
      }
      case "vault.mkdir": {
        this.permission(instance, "vault.write");
        const file = string(args[0]);
        const vault = this.host.vault();
        return this.host.serial.run(async () => {
          if (instance.stopping || this.host.vault() !== vault)
            throw Error("Хранилище изменилось");
          await vault.mkdir(file);
          this.host.changed();
        });
      }
      case "vault.rename":
      case "vault.trash": {
        this.permission(instance, "vault.manage");
        const path = string(args[0]);
        return this.host.action(
          method === "vault.rename"
            ? { type: "rename", path, to: string(args[1]) }
            : { type: "trash", path },
        );
      }
      case "metadata.index":
        this.permission(instance, "vault.read");
        return this.host.vault().index();
      case "metadata.get": {
        this.permission(instance, "vault.read");
        const file = string(args[0]);
        return (
          (await this.host.vault().index()).find((note) => note.path === file) || null
        );
      }
      case "metadata.update": {
        this.permission(instance, "vault.write");
        const file = string(args[0]),
          revision = string(args[2], 64),
          change = args[1];
        if (
          !change ||
          typeof change !== "object" ||
          JSON.stringify(change).length > 262144 ||
          !/^[a-f0-9]{64}$/.test(revision)
        )
          throw Error("Некорректная правка свойств");
        const vault = this.host.vault();
        return this.host.serial.run(async () => {
          if (instance.stopping || this.host.vault() !== vault)
            throw Error("Хранилище изменилось");
          const note = await vault.read(file);
          if (note.revision !== revision) throw Error("Файл изменился после чтения");
          const result = await vault.write(
            file,
            editFrontmatter(note.content, change),
            revision,
          );
          this.host.changed();
          return result;
        });
      }
      case "workspace.open": {
        this.permission(instance, "workspace");
        const file = string(args[0]),
          options = args[1] as
            | { split?: "row" | "column"; mode?: "live" | "source" | "read" | "split" }
            | undefined;
        if (
          options &&
          (typeof options !== "object" ||
            (options.split && !["row", "column"].includes(options.split)) ||
            (options.mode && !["live", "source", "read", "split"].includes(options.mode)))
        )
          throw Error("Некорректная панель");
        await this.host.vault().read(file);
        return this.host.action({
          type: "open",
          path: file,
          split: options?.split,
          mode: options?.mode,
        });
      }
      case "workspace.search":
        this.permission(instance, "workspace");
        return this.host.action({ type: "search", query: string(args[0], 500) });
      case "workspace.graph":
        this.permission(instance, "workspace");
        return this.host.action({ type: "graph" });
      case "ui.show": {
        this.permission(instance, "ui");
        const options = (args[0] || {}) as {
          title?: string;
          width?: number;
          height?: number;
        };
        if (typeof options !== "object") throw Error("Некорректное окно");
        const width = options.width ?? 640,
          height = options.height ?? 480;
        if (
          !Number.isFinite(width) ||
          width < 320 ||
          width > 2000 ||
          !Number.isFinite(height) ||
          height < 200 ||
          height > 1600
        )
          throw Error("Некорректный размер окна");
        instance.window.setTitle(
          instance.plugin.name +
            (options.title ? " · " + string(options.title, 120) : "") +
            " — Veltrite",
        );
        instance.window.setSize(Math.round(width), Math.round(height));
        instance.window.show();
        return;
      }
      case "ui.hide":
        this.permission(instance, "ui");
        instance.window.hide();
        return;
      case "ui.ribbon": {
        this.permission(instance, "ui");
        const value = args[0] as PluginUI["ribbon"][number];
        if (
          !value ||
          typeof value !== "object" ||
          !/^[\w-]{1,80}$/.test(value.id) ||
          !instance.plugin.commands.some((command) => command.id === value.command)
        )
          throw Error("Кнопка должна ссылаться на объявленную команду");
        if (
          instance.ui.ribbon.length >= 4 &&
          !instance.ui.ribbon.some((entry) => entry.id === value.id)
        )
          throw Error("Можно добавить до четырёх кнопок");
        const button = {
          id: value.id,
          title: string(value.title, 100),
          icon: string(value.icon || "puzzle", 40),
          command: value.command,
        };
        instance.ui.ribbon = [
          ...instance.ui.ribbon.filter((entry) => entry.id !== value.id),
          button,
        ];
        this.host.pluginsChanged();
        return;
      }
      case "ui.removeRibbon":
        this.permission(instance, "ui");
        instance.ui.ribbon = instance.ui.ribbon.filter(
          (entry) => entry.id !== string(args[0], 80),
        );
        this.host.pluginsChanged();
        return;
      case "ui.status": {
        this.permission(instance, "ui");
        const text = string(args[0], 80),
          command = args[1] === undefined ? undefined : string(args[1], 80);
        if (command && !instance.plugin.commands.some((entry) => entry.id === command))
          throw Error("Команда не объявлена");
        instance.ui.status = text ? { text, ...(command ? { command } : {}) } : null;
        this.host.pluginsChanged();
        return;
      }
      case "ui.settings": {
        this.permission(instance, "ui");
        const command = string(args[0], 80);
        if (!instance.plugin.commands.some((entry) => entry.id === command))
          throw Error("Команда не объявлена");
        instance.ui.settings = command;
        this.host.pluginsChanged();
        return;
      }
      case "editor.get":
        this.permission(instance, "editor.read");
        return this.host.context();
      case "editor.insert":
      case "editor.append":
        this.permission(instance, "editor.write");
        return this.host.action({
          type: method === "editor.insert" ? "insert" : "append",
          text: string(args[0], 1024 * 1024),
        });
        return;
      case "notice":
        this.permission(instance, "notice");
        return this.host.action({ type: "notice", text: string(args[0], 500) });
      case "storage.get":
        this.permission(instance, "storage");
        return this.plugins.storage(instance.plugin.id, string(args[0], 128));
      case "storage.set":
        this.permission(instance, "storage");
        if (args[1] === undefined) throw Error("Укажите значение настройки");
        return this.plugins.storage(instance.plugin.id, string(args[0], 128), args[1]);
      case "events.subscribe": {
        const name = string(args[0], 40);
        if (["vault:changed", "metadata:changed"].includes(name))
          this.permission(instance, "vault.read");
        else if (name === "workspace:changed") this.permission(instance, "workspace");
        else if (name === "editor:changed") this.permission(instance, "editor.read");
        else if (name === "ui:closed") this.permission(instance, "ui");
        else throw Error("Неизвестное событие");
        instance.events.add(name);
        return;
      }
      default:
        throw Error("Неизвестный метод API расширений");
    }
  }
  private request(instance: Instance, command: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("Команда расширения превысила время ожидания"));
        }, timeout);
      this.pending.set(id, { instance, timer, resolve, reject });
      try {
        instance.window.webContents.send("veltrite-plugin:run", id, command);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  reply(event: IpcMainEvent, id: unknown, error: unknown) {
    if (typeof id !== "string") return;
    const pending = this.pending.get(id);
    if (
      !pending ||
      event.sender !== pending.instance.window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (error)
      pending.reject(
        new Error(typeof error === "string" ? error.slice(0, 500) : "Ошибка расширения"),
      );
    else pending.resolve();
  }
  async execute(pluginId: string, command: string) {
    const instance = this.instances.get(pluginId);
    if (!instance || instance.stopping || !instance.commands.has(command))
      throw Error("Команда расширения недоступна");
    try {
      await this.request(instance, command, 5000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Ошибка команды";
      if (message.includes("время ожидания")) await this.fail(instance, message);
      throw error;
    }
  }
  emit(name: string, value: unknown) {
    for (const instance of this.instances.values())
      if (!instance.stopping && instance.events.has(name))
        instance.window.webContents.send("veltrite-plugin:event", name, value);
  }
  private async fail(instance: Instance, message: string) {
    if (this.instances.get(instance.plugin.id) !== instance) return;
    await this.stopNow(instance.plugin.id, true);
    await this.plugins.fail(instance.plugin.id, message);
    this.host.pluginsChanged();
  }
  stop(id: string, force = false) {
    return this.lifecycle.run(() => this.stopNow(id, force));
  }
  private async stopNow(id: string, force = false) {
    const instance = this.instances.get(id);
    if (!instance) return;
    instance.stopping = true;
    this.instances.delete(id);
    instance.rejectReady(new Error("Расширение отключено"));
    if (!force && !instance.window.isDestroyed())
      await this.request(instance, ":dispose", 500).catch(() => {});
    for (const [id, pending] of this.pending)
      if (pending.instance === instance) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Расширение отключено"));
        this.pending.delete(id);
      }
    this.senders.delete(instance.senderId);
    if (!instance.window.isDestroyed()) instance.window.destroy();
    this.host.pluginsChanged();
  }
  async close() {
    await Promise.all([...this.instances.keys()].map((id) => this.stop(id)));
  }
}
export const pluginPreload = (directory: string) =>
  path.join(directory, "plugin-preload.cjs");
