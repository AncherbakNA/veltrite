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
  "compose",
  "updateProperties",
  "rename",
  "trash",
  "trashList",
  "restoreTrash",
  "history",
  "historyRead",
  "historyRestore",
  "search",
  "index",
  "mentions",
  "linkMention",
  "importAttachments",
  "saveAudio",
  "preferences",
  "exportVault",
  "exportHtml",
  "printPdf",
  "reveal",
  "openExternal",
  "openAttachment",
  "remoteImage",
  "readAttachment",
  "copyText",
  "syncStatus",
  "syncConnect",
  "syncDisconnect",
  "syncKey",
  "syncConfirmRecovery",
  "syncNow",
  "beginLogin",
  "finishLogin",
  "cancelLogin",
  "updateState",
  "checkUpdate",
  "downloadUpdate",
  "installUpdate",
  "publishSite",
  "webViewer",
  "webCardOpen",
  "webCardBounds",
  "webCardClose",
  "catalog",
  "catalogInstall",
  "styles",
  "installStyle",
  "saveStyle",
  "removeStyle",
  "themes",
  "installTheme",
  "removeTheme",
  "plugins",
  "installPlugin",
  "togglePlugin",
  "removePlugin",
  "executePlugin",
  "updatePluginContext",
  "workspaceSave",
  "saveSession",
  "workspaces",
  "workspaceRename",
  "workspaceDelete",
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
api.onUpdateState = (callback: any) => subscribe("updates:state", callback);
api.onPluginAction = (callback: any) =>
  subscribe("plugins:action", async (action: unknown, request?: string) => {
    try {
      await callback(action);
      if (request) ipcRenderer.send("plugins:action-result", request, null);
    } catch (error) {
      if (request)
        ipcRenderer.send(
          "plugins:action-result",
          request,
          error instanceof Error ? error.message : "Ошибка действия расширения",
        );
    }
  });
api.onPluginsChanged = (callback: any) => subscribe("plugins:changed", callback);
api.onChange = (callback: any) => subscribe("vault:changed", callback);
api.onMenu = (callback: any) => subscribe("app:menu", callback);
api.closeReady = () => ipcRenderer.send("veltrite:close-ready");
contextBridge.exposeInMainWorld("veltrite", api as unknown as VeltriteAPI);
