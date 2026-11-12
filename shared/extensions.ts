import type { PluginInfo } from "./types";
export const permissionLabels = {
  "vault.read": "Читать файлы хранилища",
  "vault.write": "Создавать и изменять файлы хранилища",
  "vault.manage": "Перемещать файлы и отправлять их в корзину",
  "editor.read": "Читать открытый черновик и выделение",
  "editor.write": "Вставлять текст в редактор",
  storage: "Хранить настройки расширения",
  notice: "Показывать уведомления",
  ui: "Показывать собственные окна, кнопки и строку состояния",
  workspace: "Открывать заметки, поиск и граф",
} as const;
export type PluginPermission = keyof typeof permissionLabels;
export interface EditorContext {
  path: string | null;
  content: string;
  selection: string;
  paneId: string;
}
export type PluginAction =
  | { type: "insert" | "append" | "notice"; text: string }
  | {
      type: "open";
      path: string;
      split?: "row" | "column";
      mode?: "live" | "source" | "read" | "split";
    }
  | { type: "search"; query: string }
  | { type: "graph" }
  | { type: "rename"; path: string; to: string }
  | { type: "trash"; path: string };
export interface PluginUI {
  ribbon: { id: string; title: string; icon: string; command: string }[];
  status: { text: string; command?: string } | null;
  settings: string | null;
}
export function validatePlugin(value: unknown): PluginInfo {
  if (!value || typeof value !== "object")
    throw Error("Некорректный манифест расширения");
  const data = value as Record<string, any>;
  if (
    typeof data.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(data.id) ||
    typeof data.name !== "string" ||
    !data.name.trim() ||
    data.name.length > 100 ||
    typeof data.description !== "string" ||
    data.description.length > 2000 ||
    typeof data.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(data.version) ||
    !Array.isArray(data.commands) ||
    data.commands.length > 30
  )
    throw Error("Некорректный манифест расширения");
  const javascript = data.main !== undefined;
  if (javascript && (data.main !== "main.js" || data.apiVersion !== 1))
    throw Error("Поддерживается API 1 и точка входа main.js");
  if (
    javascript &&
    (!Array.isArray(data.permissions) ||
      data.permissions.some(
        (p: unknown) => typeof p !== "string" || !Object.hasOwn(permissionLabels, p),
      ))
  )
    throw Error("Неизвестное разрешение расширения");
  const ids = new Set<string>();
  const commands = data.commands.map((command: any) => {
    if (
      !command ||
      typeof command.id !== "string" ||
      !/^[\w-]{1,80}$/.test(command.id) ||
      ids.has(command.id) ||
      typeof command.name !== "string" ||
      !command.name.trim() ||
      command.name.length > 150 ||
      (!javascript && !["insert", "create", "open-url"].includes(command.action)) ||
      (command.value !== undefined &&
        (typeof command.value !== "string" || command.value.length > 100000))
    )
      throw Error("Некорректная команда расширения");
    ids.add(command.id);
    return {
      id: command.id,
      name: command.name,
      action: javascript ? "execute" : command.action,
      ...(!javascript && command.value !== undefined ? { value: command.value } : {}),
    };
  });
  const permissions: PluginPermission[] = javascript
    ? [...new Set<PluginPermission>(data.permissions)]
    : [];
  const grants = Array.isArray(data.grants)
    ? data.grants.filter((p: PluginPermission) => permissions.includes(p))
    : [];
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    version: data.version,
    enabled: !!data.enabled,
    commands,
    ...(javascript ? { main: "main.js", apiVersion: 1, permissions, grants } : {}),
    ...(typeof data.error === "string" ? { error: data.error.slice(0, 500) } : {}),
  };
}
