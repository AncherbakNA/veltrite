export interface ComposeRequest {
  operation: "extract" | "merge";
  source: string;
  sourceRevision: string;
  target: string;
  targetRevision?: string;
  placement: "append" | "prepend";
  replacement: "link" | "embed" | "none";
  from?: number;
  to?: number;
}
export interface ComposeResult {
  target: string;
  changed: string[];
  removed: boolean;
}
