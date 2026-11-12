import { parentPort } from "node:worker_threads";
import { parseSearch, searchDocuments, type SearchDocument } from "../shared/search";
parentPort!.on(
  "message",
  ({ documents, query }: { documents: SearchDocument[]; query: string }) => {
    try {
      const expression = parseSearch(query);
      parentPort!.postMessage({
        results: expression ? searchDocuments(documents, expression) : [],
      });
    } catch (error: any) {
      parentPort!.postMessage({ error: error.message });
    }
  },
);
