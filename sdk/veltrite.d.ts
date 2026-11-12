export interface Note {
  path: string;
  content: string;
  revision: string;
}
export interface FileEntry {
  path: string;
  name: string;
  kind: "folder" | "note" | "canvas" | "base" | "attachment";
  size: number;
  modified: number;
  created?: number;
}
export interface EditorContext {
  path: string | null;
  content: string;
  selection: string;
  paneId: string;
}
export interface Metadata {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  links: string[];
  headings: { level: number; text: string; line: number }[];
  blocks?: { id: string; line: number }[];
  embeds?: string[];
  properties: Record<string, unknown>;
  words: number;
}
export interface PropertyChange {
  set?: Record<string, unknown>;
  remove?: string[];
  rename?: { from: string; to: string };
}
export interface PluginAPI {
  readonly version: 1;
  commands: {
    register(id: string, handler: () => unknown): Promise<() => Promise<void>>;
  };
  vault: {
    list(): Promise<FileEntry[]>;
    read(path: string): Promise<Note>;
    create(path: string, content?: string): Promise<Note>;
    write(path: string, content: string, revision: string): Promise<Note>;
    mkdir(path: string): Promise<void>;
    rename(path: string, to: string): Promise<void>;
    trash(path: string): Promise<void>;
    process(
      path: string,
      transform: (text: string) => string | Promise<string>,
    ): Promise<Note>;
  };
  metadata: {
    index(): Promise<Metadata[]>;
    get(path: string): Promise<Metadata | null>;
    update(path: string, change: PropertyChange, revision: string): Promise<Note>;
  };
  workspace: {
    open(
      path: string,
      options?: { split?: "row" | "column"; mode?: "live" | "source" | "read" | "split" },
    ): Promise<void>;
    search(query: string): Promise<void>;
    graph(): Promise<void>;
  };
  ui: {
    show(options?: { title?: string; width?: number; height?: number }): Promise<void>;
    hide(): Promise<void>;
    addRibbon(button: {
      id: string;
      title: string;
      icon?: string;
      command: string;
    }): Promise<() => Promise<void>>;
    status(text: string, command?: string): Promise<void>;
    registerSettings(command: string): Promise<void>;
  };
  editor: {
    get(): Promise<EditorContext>;
    replaceSelection(text: string): Promise<void>;
    append(text: string): Promise<void>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<unknown>;
  };
  notice(text: string): Promise<void>;
  on(
    event:
      | "vault:changed"
      | "editor:changed"
      | "metadata:changed"
      | "workspace:changed"
      | "ui:closed",
    callback: (value: unknown) => void,
  ): Promise<() => void>;
  onUnload(dispose: () => unknown): () => void;
}
export type Activate = (
  api: PluginAPI,
) => void | (() => unknown) | Promise<void | (() => unknown)>;
