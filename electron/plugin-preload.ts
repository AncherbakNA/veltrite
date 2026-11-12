import { contextBridge, ipcRenderer } from "electron";
const commands = new Map<string, () => unknown>(),
  disposers = new Set<() => unknown>();
const call = (method: string, ...args: unknown[]) =>
  ipcRenderer.invoke("veltrite-plugin:invoke", method, args);
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
contextBridge.exposeInMainWorld("veltritePlugin", {
  version: 1,
  commands: {
    register: async (id: string, handler: () => unknown) => {
      if (typeof handler !== "function") throw Error("Нужен обработчик команды");
      await call("commands.register", id);
      commands.set(id, handler);
      return () => commands.delete(id);
    },
  },
  vault: {
    list: () => call("vault.list"),
    read: (path: string) => call("vault.read", path),
    write: (path: string, content: string, revision: string) =>
      call("vault.write", path, content, revision),
    create: (path: string, content = "") => call("vault.create", path, content),
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
});
