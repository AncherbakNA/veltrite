import { buildGraph } from "../../shared/graph";
import { layoutGraph } from "../../shared/graph-layout";
import type { NoteIndex } from "../../shared/types";
self.onmessage = (
  event: MessageEvent<{
    index: NoteIndex[];
    query: string;
    local: boolean;
    active: string | null;
  }>,
) => {
  try {
    const { index, query, local, active } = event.data;
    self.postMessage({ graph: layoutGraph(buildGraph(index, query, local, active)) });
  } catch (error: unknown) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Не удалось построить граф",
    });
  }
};
