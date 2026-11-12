import { contextBridge, ipcRenderer } from "electron";
import type { PluginAPI } from "../sdk/veltrite";
const commands = new Map<string, () => unknown>(),
  disposers = new Set<() => unknown>();
let activeRequests = 0;
const call = async (method: string, ...args: unknown[]) => {
  if (activeRequests >= 16)
    throw Error("Расширение отправило слишком много одновременных запросов");
  activeRequests++;
  try {
    return await ipcRenderer.invoke("veltrite-plugin:invoke", method, args);
  } finally {
    activeRequests--;
  }
};
const subscribe = (name: string, callback: (value: unknown) => void) => {
  const listener = (_event: unknown, event: string, value: unknown) => {
    if (event === name) callback(value);
  };
  ipcRenderer.on("veltrite-plugin:event", listener);
  const off = () => ipcRenderer.removeListener("veltrite-plugin:event", listener);
  disposers.add(off);
  return () => {
    disposers.delete(off);
    off();
  };
};
ipcRenderer.on(
  "veltrite-plugin:run",
  async (_event, request: string, command: string) => {
    try {
      if (command === ":dispose")
        await Promise.allSettled(
          [...disposers].map((dispose) => Promise.resolve().then(dispose)),
        );
      else {
        const handler = commands.get(command);
        if (!handler) throw Error("Команда расширения не зарегистрирована");
        await handler();
      }
      ipcRenderer.send("veltrite-plugin:reply", request, null);
    } catch (error: unknown) {
      ipcRenderer.send(
        "veltrite-plugin:reply",
        request,
        error instanceof Error ? error.message.slice(0, 500) : "Ошибка расширения",
      );
    }
  },
);
const pluginAPI: PluginAPI & {
  ready: () => Promise<void>;
  failed: (message: string) => Promise<void>;
} = {
  version: 1,
  commands: {
    register: async (id: string, handler: () => unknown) => {
      if (typeof handler !== "function") throw Error("Нужен обработчик команды");
      if (commands.has(id)) throw Error("Команда уже зарегистрирована");
      commands.set(id, handler);
      try {
        await call("commands.register", id);
      } catch (error) {
        commands.delete(id);
        throw error;
      }
      return async () => {
        if (commands.get(id) !== handler) return;
        await call("commands.unregister", id);
        commands.delete(id);
      };
    },
  },
  vault: {
    list: () => call("vault.list"),
    read: (path: string) => call("vault.read", path),
    write: (path: string, content: string, revision: string) =>
      call("vault.write", path, content, revision),
    create: (path: string, content = "") => call("vault.create", path, content),
    mkdir: (path: string) => call("vault.mkdir", path),
    rename: (path: string, to: string) => call("vault.rename", path, to),
    trash: (path: string) => call("vault.trash", path),
    process: async (
      path: string,
      transform: (text: string) => string | Promise<string>,
    ) => {
      const note = await call("vault.read", path);
      const text = await transform(note.content);
      return call("vault.write", path, text, note.revision);
    },
  },
  metadata: {
    index: () => call("metadata.index"),
    get: (path: string) => call("metadata.get", path),
    update: (path: string, change: unknown, revision: string) =>
      call("metadata.update", path, change, revision),
  },
  workspace: {
    open: (path: string, options?: unknown) => call("workspace.open", path, options),
    search: (query: string) => call("workspace.search", query),
    graph: () => call("workspace.graph"),
  },
  ui: {
    show: (options?: unknown) => call("ui.show", options),
    hide: () => call("ui.hide"),
    addRibbon: async (value: {
      id: string;
      title: string;
      icon?: string;
      command: string;
    }) => {
      await call("ui.ribbon", value);
      return () => call("ui.removeRibbon", value.id);
    },
    status: (text: string, command?: string) => call("ui.status", text, command),
    registerSettings: (command: string) => call("ui.settings", command),
  },
  editor: {
    get: () => call("editor.get"),
    replaceSelection: (text: string) => call("editor.insert", text),
    append: (text: string) => call("editor.append", text),
  },
  storage: {
    get: (key: string) => call("storage.get", key),
    set: (key: string, value: unknown) => call("storage.set", key, value),
  },
  notice: (text: string) => call("notice", text),
  on: async (name: string, callback: (value: unknown) => void) => {
    if (typeof callback !== "function") throw Error("Нужен обработчик события");
    await call("events.subscribe", name);
    return subscribe(name, callback);
  },
  onUnload: (dispose: () => unknown) => {
    if (typeof dispose !== "function") throw Error("Нужен обработчик завершения");
    disposers.add(dispose);
    return () => disposers.delete(dispose);
  },
  ready: () => call("ready"),
  failed: (message: string) => call("failed", message),
};
contextBridge.exposeInMainWorld("veltritePlugin", pluginAPI);
