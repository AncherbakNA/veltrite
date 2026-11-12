import type { BrowserWindow, IpcMainEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { PluginAction } from "../shared/extensions";
/** A plugin's awaited operation resolves after the renderer accepts/applies it. */
export class PluginActions {
  private pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(private window: BrowserWindow) {}
  send(action: PluginAction): Promise<void> {
    if (this.window.isDestroyed())
      return Promise.reject(Error("Окно приложения закрыто"));
    return new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(Error("Окно приложения не выполнило действие расширения"));
        }, 6000);
      this.pending.set(id, { resolve, reject, timer });
      this.window.webContents.send("plugins:action", action, id);
    });
  }
  reply(event: IpcMainEvent, id: unknown, error: unknown) {
    if (
      typeof id !== "string" ||
      this.window.isDestroyed() ||
      event.sender !== this.window.webContents ||
      event.senderFrame !== this.window.webContents.mainFrame
    )
      return;
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id);
    clearTimeout(item.timer);
    if (error)
      item.reject(
        Error(
          typeof error === "string"
            ? error.slice(0, 500)
            : "Не удалось выполнить действие",
        ),
      );
    else item.resolve();
  }
  close() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error("Окно приложения закрыто"));
    }
    this.pending.clear();
  }
}
