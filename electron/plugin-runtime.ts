import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { EditorContext, PluginAction, PluginPermission } from "../shared/extensions";
import type { PluginInfo } from "../shared/types";
import type { Plugins } from "./plugins";
import { Serial, type Vault } from "./vault";
interface Host {
  vault: () => Vault;
  serial: Serial;
  changed: () => void;
  context: () => EditorContext;
  action: (action: PluginAction) => void;
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
      "default-src 'none'; script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
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
      case "editor.get":
        this.permission(instance, "editor.read");
        return this.host.context();
      case "editor.insert":
      case "editor.append":
        this.permission(instance, "editor.write");
        this.host.action({
          type: method === "editor.insert" ? "insert" : "append",
          text: string(args[0], 1024 * 1024),
        });
        return;
      case "notice":
        this.permission(instance, "notice");
        this.host.action({ type: "notice", text: string(args[0], 500) });
        return;
      case "storage.get":
        this.permission(instance, "storage");
        return this.plugins.storage(instance.plugin.id, string(args[0], 128));
      case "storage.set":
        this.permission(instance, "storage");
        if (args[1] === undefined) throw Error("Укажите значение настройки");
        return this.plugins.storage(instance.plugin.id, string(args[0], 128), args[1]);
      case "events.subscribe": {
        const name = string(args[0], 40);
        if (name === "vault:changed") this.permission(instance, "vault.read");
        else if (name === "editor:changed") this.permission(instance, "editor.read");
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
