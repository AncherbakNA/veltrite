import { contextBridge, ipcRenderer } from "electron";
import type { VeltriteAPI } from "../shared/types";
const methods = [
  "state",
  "chooseVault",
  "openRecent",
  "importFolder",
  "refresh",
  "read",
  "write",
  "create",
  "mkdir",
  "rename",
  "trash",
  "trashList",
  "restoreTrash",
  "history",
  "historyRead",
  "historyRestore",
  "search",
  "index",
  "importAttachments",
  "saveAudio",
  "preferences",
  "exportVault",
  "exportHtml",
  "printPdf",
  "reveal",
  "openExternal",
  "openAttachment",
  "syncStatus",
  "syncConnect",
  "syncDisconnect",
  "syncKey",
  "syncConfirmRecovery",
  "syncNow",
  "beginLogin",
  "finishLogin",
  "cancelLogin",
  "checkUpdate",
  "installUpdate",
  "publishSite",
  "webViewer",
  "webCardOpen",
  "webCardBounds",
  "webCardClose",
  "plugins",
  "installPlugin",
  "togglePlugin",
  "workspaceSave",
  "saveSession",
  "workspaces",
] as const;
const api: Record<string, any> = Object.fromEntries(
  methods.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke("veltrite:" + method, ...args),
  ]),
);
function subscribe(channel: string, callback: (...args: any[]) => void) {
  const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
api.onChange = (callback: any) => subscribe("vault:changed", callback);
api.onMenu = (callback: any) => subscribe("app:menu", callback);
api.closeReady = () => ipcRenderer.send("veltrite:close-ready");
contextBridge.exposeInMainWorld("veltrite", api as unknown as VeltriteAPI);
