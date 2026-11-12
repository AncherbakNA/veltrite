import { useEffect, useRef, useState } from "react";
import type { BasePage, BaseQueryInput } from "../shared/base-query";
export const emptyBasePage: BasePage = {
  order: [],
  values: [],
  warnings: [],
  summaries: {},
  points: [],
  groupCounts: {},
};
export function useBaseQuery(input: BaseQueryInput, start: number, size = 200) {
  const [clock, setClock] = useState(0);
  const timeDependent = /\b(?:now|today|relative)\s*\(/.test(
    JSON.stringify([input.document.formulas, input.document.filters, input.view.filters]),
  );
  useEffect(() => {
    if (!timeDependent) return;
    const interval = setInterval(() => setClock((value) => value + 1), 60000);
    return () => clearInterval(interval);
  }, [timeDependent]);
  const [data, setData] = useState<BasePage>(emptyBasePage),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const active = useRef<Worker | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    page = useRef({ start, size });
  page.current = { start, size };
  const watch = (worker: Worker) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (active.current === worker) {
        worker.terminate();
        active.current = null;
        setData(emptyBasePage);
        setLoading(false);
        setError(
          "Вычисление базы заняло слишком много времени. Упростите формулы или регулярные выражения",
        );
      }
    }, 8000);
  };
  useEffect(() => {
    const worker = new Worker(new URL("./workers/base.ts", import.meta.url), {
      type: "module",
    });
    active.current = worker;
    setError("");
    setLoading(true);
    watch(worker);
    worker.onmessage = (event) => {
      if (active.current !== worker) return;
      if (timer.current) clearTimeout(timer.current);
      if (event.data.error) {
        setData(emptyBasePage);
        setError(event.data.error);
        setLoading(false);
        return;
      }
      if (event.data.start !== page.current.start) {
        worker.postMessage(page.current);
        watch(worker);
        return;
      }
      setData(event.data.data);
      setLoading(false);
    };
    worker.onerror = () => {
      if (active.current === worker) {
        if (timer.current) clearTimeout(timer.current);
        worker.terminate();
        active.current = null;
        setData(emptyBasePage);
        setError("Не удалось вычислить базу");
        setLoading(false);
      }
    };
    worker.postMessage({ input, ...page.current });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (active.current === worker) active.current = null;
      worker.terminate();
    };
  }, [
    input.index,
    input.files,
    input.document,
    input.view,
    JSON.stringify(input.columns),
    input.filter,
    input.sort,
    input.ascending,
    input.path,
    input.contextPath,
    clock,
    JSON.stringify(input.types),
  ]);
  useEffect(() => {
    const worker = active.current;
    if (worker) {
      setLoading(true);
      worker.postMessage({ start, size });
      watch(worker);
    }
  }, [start, size]);
  return { data, loading, error };
}
