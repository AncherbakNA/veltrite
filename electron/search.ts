import { Worker } from "node:worker_threads";
import type { SearchDocument } from "../shared/search";
import type { SearchResult } from "../shared/types";
/** Each query owns an interruptible worker; pathological regexes cannot block Electron. */
export function runSearch(
  workerFile: string,
  documents: SearchDocument[],
  query: string,
  signal?: AbortSignal,
  timeout = 1500,
): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let finished = false;
    const done = (error?: Error, results: SearchResult[] = []) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      void worker.terminate();
      if (error) reject(error);
      else resolve(results);
    };
    const cancel = () => done(new Error("Поиск отменён"));
    const timer = setTimeout(
      () =>
        done(
          new Error(
            "Поиск занял слишком много времени. Упростите регулярное выражение или сузьте запрос.",
          ),
        ),
      timeout,
    );
    worker.once("error", (error) => done(error));
    worker.once("exit", (code) => {
      if (!finished) done(new Error(`Поисковый процесс завершился (${code})`));
    });
    worker.once("message", (message) =>
      done(message.error ? new Error(message.error) : undefined, message.results),
    );
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    else worker.postMessage({ documents, query });
  });
}
