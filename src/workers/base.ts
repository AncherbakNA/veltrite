import { baseQuery, type BaseQueryInput } from "../../shared/base-query";
let query: ReturnType<typeof baseQuery> | null = null;
self.onmessage = (
  event: MessageEvent<{ input?: BaseQueryInput; start: number; size: number }>,
) => {
  try {
    if (event.data.input) query = baseQuery(event.data.input);
    if (!query) throw Error("База ещё не открыта");
    self.postMessage({
      data: query.page(event.data.start, event.data.size),
      start: event.data.start,
    });
  } catch (error: any) {
    self.postMessage({ error: error.message });
  }
};
