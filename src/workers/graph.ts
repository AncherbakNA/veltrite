import { buildGraph } from "../../shared/graph";
import { layoutGraph } from "../../shared/graph-layout";
import type { GraphOptions } from "../../shared/graph-options";
import type { FileEntry, NoteIndex } from "../../shared/types";
self.onmessage = (
  event: MessageEvent<{
    index: NoteIndex[];
    options: GraphOptions;
    files: FileEntry[];
    query: string;
    local: boolean;
    active: string | null;
  }>,
) => {
  try {
    const { index, query, local, active, options, files } = event.data;
    self.postMessage({
      graph: layoutGraph(
        buildGraph(index, query, local, active, options, files),
        1200,
        options,
      ),
    });
  } catch (error: unknown) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Не удалось построить граф",
    });
  }
};
