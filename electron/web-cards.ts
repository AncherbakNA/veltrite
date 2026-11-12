import { BrowserWindow, WebContentsView } from "electron";
import { randomUUID } from "node:crypto";
export interface CardBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}
/** Remote pages have no preload, no vault session, no permissions and no IPC bridge. */
export class WebCards {
  private cards = new Map<string, WebContentsView>();
  constructor(private window: BrowserWindow) {
    window.on("closed", () => this.closeAll());
  }
  async open(id: string, address: string) {
    if (!/^[\w-]{1,80}$/.test(id) || this.cards.has(id) || this.cards.size >= 4)
      throw Error("Одновременно можно открыть до четырёх веб-карточек");
    const url = new URL(address);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      address.length > 8192
    )
      throw Error("Введите обычную ссылку HTTP или HTTPS");
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: "veltrite-card-" + randomUUID(),
        safeDialogs: true,
      },
    });
    const contents = view.webContents;
    const session = contents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event) => event.preventDefault());
    session.webRequest.onBeforeRequest((details, callback) => {
      const allowed = ["http:", "https:", "ws:", "wss:", "data:", "blob:"].includes(
        new URL(details.url).protocol,
      );
      callback({ cancel: !allowed });
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, target) => {
      if (!/^https?:\/\//i.test(target)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    view.setVisible(false);
    this.cards.set(id, view);
    this.window.contentView.addChildView(view);
    try {
      await contents.loadURL(url.href);
    } catch (error) {
      if (this.cards.get(id) === view) this.close(id);
      throw error;
    }
  }
  bounds(id: string, bounds: CardBounds) {
    const view = this.cards.get(id);
    if (!view) return;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
      throw Error("Некорректный размер карточки");
    const size = this.window.getContentBounds();
    const x = Math.max(0, Math.min(size.width, Math.round(bounds.x))),
      y = Math.max(0, Math.min(size.height, Math.round(bounds.y)));
    const width = Math.max(0, Math.min(size.width - x, Math.round(bounds.width))),
      height = Math.max(0, Math.min(size.height - y, Math.round(bounds.height)));
    view.setVisible(!!bounds.visible && width >= 60 && height >= 40);
    view.setBounds({ x, y, width, height });
  }
  close(id: string) {
    const view = this.cards.get(id);
    if (!view) return;
    this.cards.delete(id);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed())
      view.webContents.close({ waitForBeforeUnload: false });
  }
  closeAll() {
    for (const id of this.cards.keys()) this.close(id);
  }
}
