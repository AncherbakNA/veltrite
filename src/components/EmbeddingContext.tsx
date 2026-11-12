import { createContext, useContext, useMemo, type ReactNode } from "react";
export const EmbeddingContext = createContext<string[]>([]);
export const EmbeddingBudgetContext = createContext<Map<string, Set<string>> | null>(
  null,
);
export function EmbeddingRoot({ path, children }: { path: string; children: ReactNode }) {
  const parents = useContext(EmbeddingContext),
    inherited = useContext(EmbeddingBudgetContext),
    own = useMemo(() => new Map<string, Set<string>>(), [path]);
  const chain = useMemo(
    () => (parents.at(-1) === path ? parents : [...parents, path]),
    [parents, path],
  );
  return (
    <EmbeddingBudgetContext.Provider value={inherited || own}>
      <EmbeddingContext.Provider value={chain}>{children}</EmbeddingContext.Provider>
    </EmbeddingBudgetContext.Provider>
  );
}
