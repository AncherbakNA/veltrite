import { createContext } from "react";
import type { PropertyType } from "../shared/properties";
import type { FileEntry } from "../shared/types";
export const VaultFilesContext = createContext<string[]>([]);
export const VaultRuntimeContext = createContext<{
  files: FileEntry[];
  types: Record<string, PropertyType>;
  flush?: () => Promise<unknown>;
}>({ files: [], types: {} });
