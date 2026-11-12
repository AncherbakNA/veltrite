export type UpdatePhase =
  "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";
export interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  progress: number;
  automatic: boolean;
  url: string;
  error: string | null;
}
export function compareVersions(a: string, b: string): number {
  if (!/^\d+\.\d+\.\d+$/.test(a) || !/^\d+\.\d+\.\d+$/.test(b))
    throw Error("Некорректная версия обновления");
  const first = a.split(".").map(BigInt),
    second = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++)
    if (first[i] !== second[i]) return first[i] > second[i] ? 1 : -1;
  return 0;
}
