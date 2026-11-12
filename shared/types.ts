import type { Bookmark } from "./bookmarks";
import type { CatalogEntry, CatalogInfo } from "./catalog";
import type { ComposeRequest, ComposeResult } from "./composer";
import type {
  EditorContext,
  PluginAction,
  PluginPermission,
  PluginUI,
} from "./extensions";
import type { PropertyChange } from "./frontmatter-edit";
import { defaultGraphOptions, type GraphOptions } from "./graph-options";
import type { Hotkeys } from "./hotkeys";
import type { UnlinkedMention } from "./mentions";
import type { WorkspaceSession } from "./panes";
import type { PropertyType } from "./properties";
import type { StyleDefinition } from "./styles";
import { DEFAULT_ACCENT, type ThemeDefinition } from "./themes";
import type { UpdateState } from "./updates";
export type Theme = "dark" | "light" | "system";
export interface Preferences {
  customTheme: ThemeDefinition | null;
  theme: Theme;
  fontSize: number;
  textFont: "serif" | "sans" | "mono";
  startupView: "last-note" | "home";
  lineNumbers: boolean;
  spellcheck: boolean;
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  dailyOpenOnStartup: boolean;
  uniqueFormat: string;
  uniqueTemplate: string;
  templateDateFormat: string;
  templateTimeFormat: string;
  attachmentFolder: string;
  templatesFolder: string;
  autoSync: boolean;
  syncInterval: number;
  readableLineLength: boolean;
  accent: string;
  vimMode: boolean;
  bookmarks: string[];
  bookmarkItems: Bookmark[];
  hotkeys: Hotkeys;
  propertyTypes: Record<string, PropertyType>;
  cssTheme: string | null;
  cssSnippets: string[];
  styleRevision: number;
  graph: GraphOptions;
}
export const defaultPreferences: Preferences = {
  customTheme: null,
  theme: "dark",
  fontSize: 16,
  textFont: "serif",
  startupView: "last-note",
  lineNumbers: false,
  spellcheck: true,
  dailyFolder: "Дневник",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplate: "",
  dailyOpenOnStartup: false,
  uniqueFormat: "YYYYMMDDHHmmss",
  uniqueTemplate: "",
  templateDateFormat: "YYYY-MM-DD",
  templateTimeFormat: "HH:mm",
  attachmentFolder: "Вложения",
  templatesFolder: "Шаблоны",
  autoSync: false,
  syncInterval: 300,
  readableLineLength: true,
  accent: DEFAULT_ACCENT,
  vimMode: false,
  bookmarks: [],
  bookmarkItems: [],
  hotkeys: {},
  propertyTypes: {},
  cssTheme: null,
  cssSnippets: [],
  styleRevision: 0,
  graph: defaultGraphOptions,
};
export interface FileEntry {
  path: string;
  name: string;
  kind: "folder" | "note" | "canvas" | "base" | "attachment";
  size: number;
  modified: number;
  created?: number;
}
export interface VaultInfo {
  id: string;
  name: string;
  root: string;
  files: FileEntry[];
  preferences: Preferences;
}
export interface NoteData {
  path: string;
  content: string;
  revision: string;
}
export interface SearchResult {
  path: string;
  line: number;
  text: string;
}
export interface NoteIndex {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  links: string[];
  headings: { level: number; text: string; line: number }[];
  properties: Record<string, unknown>;
  words: number;
  blocks?: { id: string; line: number }[];
  embeds?: string[];
}
export interface SyncStatus {
  recoverySaved: boolean;
  error: string | null;
  configured: boolean;
  repository: string;
  account: string;
  encrypted: true;
  lastSync: string | null;
  busy: boolean;
  hasKey: boolean;
  deviceFlowAvailable: boolean;
}
export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  conflicts: string[];
  at: string;
}
export interface SnapshotFile {
  hash: string;
  content: string;
}
export type Snapshot = Record<string, SnapshotFile>;
export interface MergeResult {
  files: Snapshot;
  conflicts: string[];
}
export type CanvasNode =
  | {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      type: "file";
      file: string;
      subpath?: string;
    }
  | {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      type: "link";
      url: string;
    }
  | {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      type: "group";
      label?: string;
      background?: string;
      backgroundStyle?: string;
    };
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  fromEnd?: string;
  toEnd?: string;
  color?: string;
  label?: string;
}
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
export interface HistoryItem {
  id: string;
  at: string;
  size: number;
}
export interface ImportResult {
  imported: number;
  skipped: string[];
  warnings: string[];
  vault: VaultInfo;
  session?: WorkspaceSession;
  workspaces?: (WorkspaceSession & { name: string })[];
}
export interface PluginInfo {
  ui?: PluginUI;
  registeredCommands?: string[];
  main?: "main.js";
  apiVersion?: 1;
  permissions?: PluginPermission[];
  grants?: PluginPermission[];
  error?: string;
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  commands: { id: string; name: string; action: string; value?: string }[];
}
export interface AppState {
  session: WorkspaceSession | null;
  version: string;
  recent: { root: string; name: string }[];
  vault: VaultInfo | null;
  sync: SyncStatus;
}
export interface VeltriteAPI {
  state(): Promise<AppState>;
  chooseVault(create: boolean): Promise<VaultInfo | null>;
  openRecent(root: string): Promise<VaultInfo>;
  importFolder(): Promise<ImportResult | null>;
  refresh(): Promise<FileEntry[]>;
  read(path: string): Promise<NoteData>;
  write(path: string, content: string, revision?: string): Promise<NoteData>;
  create(path: string, content?: string): Promise<NoteData>;
  updateProperties(paths: string[], change: PropertyChange): Promise<number>;
  compose(request: ComposeRequest): Promise<ComposeResult>;
  mkdir(path: string): Promise<void>;
  rename(path: string, to: string): Promise<void>;
  trash(path: string): Promise<void>;
  trashList(): Promise<{ id: string; path: string; at: string }[]>;
  restoreTrash(id: string): Promise<void>;
  history(path: string): Promise<HistoryItem[]>;
  historyRead(path: string, id: string): Promise<string>;
  historyRestore(path: string, id: string): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
  index(): Promise<NoteIndex[]>;
  mentions(path: string): Promise<{
    incoming: UnlinkedMention[];
    outgoing: UnlinkedMention[];
    truncated: boolean;
  }>;
  linkMention(mention: UnlinkedMention): Promise<NoteData>;
  importAttachments(): Promise<string[]>;
  saveAudio(bytes: number[]): Promise<string>;
  preferences(patch: Partial<Preferences>): Promise<Preferences>;
  exportVault(): Promise<boolean>;
  exportHtml(path: string, html: string): Promise<boolean>;
  printPdf(): Promise<boolean>;
  reveal(path?: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openAttachment(path: string): Promise<void>;
  remoteImage(url: string): Promise<string>;
  readAttachment(path: string): Promise<Uint8Array>;
  copyText(text: string): Promise<void>;
  syncStatus(): Promise<SyncStatus>;
  syncConnect(options: {
    repository: string;
    token?: string;
    key?: string;
  }): Promise<SyncStatus>;
  syncDisconnect(): Promise<void>;
  syncKey(): Promise<string>;
  syncConfirmRecovery(): Promise<SyncStatus>;
  syncNow(): Promise<SyncResult>;
  beginLogin(): Promise<{
    userCode: string;
    verificationUri: string;
    expiresIn: number;
  }>;
  finishLogin(): Promise<SyncStatus>;
  cancelLogin(): Promise<void>;
  updateState(): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  publishSite(
    pages: { path: string; title: string; html: string }[],
  ): Promise<number | null>;
  webViewer(url: string): Promise<void>;
  webCardOpen(id: string, url: string): Promise<void>;
  webCardBounds(
    id: string,
    bounds: { x: number; y: number; width: number; height: number; visible: boolean },
  ): Promise<void>;
  webCardClose(id: string): Promise<void>;
  catalog(refresh?: boolean): Promise<CatalogInfo>;
  catalogInstall(kind: CatalogEntry["kind"], id: string): Promise<void>;
  styles(): Promise<StyleDefinition[]>;
  installStyle(kind: StyleDefinition["kind"]): Promise<StyleDefinition | null>;
  saveStyle(id: string, css: string): Promise<void>;
  removeStyle(id: string): Promise<void>;
  themes(): Promise<ThemeDefinition[]>;
  installTheme(): Promise<ThemeDefinition | null>;
  removeTheme(id: string): Promise<void>;
  plugins(): Promise<PluginInfo[]>;
  installPlugin(): Promise<PluginInfo | null>;
  togglePlugin(id: string, enabled: boolean, grants?: PluginPermission[]): Promise<void>;
  removePlugin(id: string): Promise<void>;
  executePlugin(id: string, command: string): Promise<void>;
  updatePluginContext(context: EditorContext): Promise<void>;
  onPluginAction(callback: (action: PluginAction) => void | Promise<void>): () => void;
  onPluginsChanged(callback: () => void): () => void;
  workspaceSave(name: string, data: WorkspaceSession): Promise<void>;
  saveSession(data: WorkspaceSession): Promise<void>;
  workspaceRename(from: string, to: string): Promise<void>;
  workspaceDelete(name: string): Promise<void>;
  workspaces(): Promise<(WorkspaceSession & { name: string })[]>;
  onChange(callback: (reason?: "files" | "settings") => void): () => void;
  onMenu(callback: (action: string) => void): () => void;
  closeReady(): void;
}
