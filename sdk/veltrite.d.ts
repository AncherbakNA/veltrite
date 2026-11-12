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
}
export interface EditorContext {
  path: string | null;
  content: string;
  selection: string;
  paneId: string;
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
    event: "vault:changed" | "editor:changed",
    callback: (value: unknown) => void,
  ): Promise<() => void>;
  onUnload(dispose: () => unknown): () => void;
}
export type Activate = (
  api: PluginAPI,
) => void | (() => unknown) | Promise<void | (() => unknown)>;
