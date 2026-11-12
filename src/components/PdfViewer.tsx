import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../useVault";
GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfViewer({
  path,
  fragment = "",
}: {
  path: string;
  fragment?: string;
}) {
  const first = Number(new URLSearchParams(fragment.replace(/^#/, "")).get("page")) || 1;
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(first),
    [scale, setScale] = useState(1),
    [rotation, setRotation] = useState(0),
    [width, setWidth] = useState(700),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [matches, setMatches] = useState<number[]>([]),
    [searching, setSearching] = useState(false),
    [busy, setBusy] = useState(true);
  const [passwordRequest, setPasswordRequest] = useState<{
      respond: (password: string) => void;
      incorrect: boolean;
    } | null>(null),
    [password, setPassword] = useState("");
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    text = useRef<HTMLDivElement>(null),
    searchRun = useRef(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(150, entry.contentRect.width - 32)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true,
      task: ReturnType<typeof getDocument> | undefined;
    setPdf(null);
    setError("");
    setBusy(true);
    setPage(first);
    setQuery("");
    setMatches([]);
    setPasswordRequest(null);
    setPassword("");
    api()
      .readAttachment(path)
      .then((bytes) => {
        if (!alive) return;
        const resources = new URL("./pdf/", window.location.href).href;
        task = getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: resources + "cmaps/",
          cMapPacked: true,
          standardFontDataUrl: resources + "standard_fonts/",
          wasmUrl: resources + "wasm/",
          useWasm: false,
          useWorkerFetch: false,
        });
        task.onPassword = (respond: (password: string) => void, reason: number) => {
          if (alive) {
            setPasswordRequest({ respond, incorrect: reason === 2 });
            setBusy(false);
          }
        };
        return task.promise;
      })
      .then((document) => {
        if (alive && document) {
          setPdf(document);
          setPage(Math.max(1, Math.min(first, document.numPages)));
        }
      })
      .catch((error) => {
        if (alive) {
          setError(error.message || "Не удалось открыть PDF");
          setBusy(false);
        }
      });
    return () => {
      alive = false;
      searchRun.current++;
      void task?.destroy();
    };
  }, [path, first]);
  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let alive = true,
      render: RenderTask | undefined,
      layer: TextLayer | undefined;
    setBusy(true);
    setError("");
    const element = canvas.current,
      textElement = text.current;
    pdf
      .getPage(page)
      .then(async (document) => {
        if (!alive) return;
        const rotationValue = (document.rotate + rotation) % 360,
          original = document.getViewport({ scale: 1, rotation: rotationValue }),
          ratio = Math.min(window.devicePixelRatio || 1, 2);
        const factor = Math.min(
          4,
          (width / original.width) * scale,
          Math.sqrt(12000000 / (original.width * original.height * ratio * ratio)),
          16000 / (Math.max(original.width, original.height) * ratio),
        );
        if (!Number.isFinite(factor) || factor < 0.00001)
          throw Error("Недопустимый размер страницы");
        const viewport = document.getViewport({ scale: factor, rotation: rotationValue });
        element.width = Math.ceil(viewport.width * ratio);
        element.height = Math.ceil(viewport.height * ratio);
        element.style.width = viewport.width + "px";
        element.style.height = viewport.height + "px";
        textElement.replaceChildren();
        textElement.style.setProperty("--total-scale-factor", String(factor));
        textElement.style.width = viewport.width + "px";
        textElement.style.height = viewport.height + "px";
        render = document.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (!alive) return;
        layer = new TextLayer({
          textContentSource: await document.getTextContent(),
          container: textElement,
          viewport,
        });
        await layer.render();
        if (alive) setBusy(false);
      })
      .catch((error) => {
        if (
          alive &&
          error.name !== "RenderingCancelledException" &&
          error.name !== "AbortException"
        ) {
          setError("Не удалось показать страницу PDF");
          setBusy(false);
        }
      });
    return () => {
      alive = false;
      render?.cancel();
      layer?.cancel();
    };
  }, [pdf, page, width, scale, rotation]);
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (
        event as CustomEvent<{ path: string; paneId: string; page: number }>
      ).detail;
      if (
        detail.path === path &&
        host.current?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ===
          detail.paneId &&
        pdf
      )
        setPage(Math.min(pdf.numPages, Math.max(1, detail.page)));
    };
    window.addEventListener("veltrite:pdf-page", navigate);
    return () => window.removeEventListener("veltrite:pdf-page", navigate);
  }, [path, pdf]);
  const find = async () => {
    if (!pdf) return;
    const run = ++searchRun.current,
      needle = query.trim().toLocaleLowerCase();
    setMatches([]);
    if (!needle) return;
    setSearching(true);
    try {
      const found: number[] = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 2000); i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        if (run !== searchRun.current) return;
        if (
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)
        )
          found.push(i);
        if (i % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (run === searchRun.current) {
        setMatches(found);
        if (found.length) setPage(found[0]);
      }
    } catch {
      if (run === searchRun.current) setError("Поиск в PDF прерван");
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  };
  return (
    <div
      className="pdf-viewer"
      data-pdf-path={path}
      data-pdf-ready={!!pdf}
      ref={host}
      aria-label={"PDF " + path}
    >
      <div className="pdf-toolbar">
        <button
          title="Предыдущая страница PDF"
          disabled={!pdf || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <input
          aria-label="Страница PDF"
          type="number"
          min={1}
          max={pdf?.numPages || 1}
          value={page}
          onChange={(e) =>
            setPage(
              Math.max(1, Math.min(pdf?.numPages || 1, Number(e.target.value) || 1)),
            )
          }
        />
        <span>/ {pdf?.numPages || "—"}</span>
        <button
          title="Следующая страница PDF"
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <button
          title="Уменьшить PDF"
          onClick={() => setScale((value) => Math.max(0.3, value / 1.2))}
        >
          <ZoomOut size={15} />
        </button>
        <button title="По ширине PDF" onClick={() => setScale(1)}>
          {Math.round(scale * 100)}%
        </button>
        <button
          title="Увеличить PDF"
          onClick={() => setScale((value) => Math.min(4, value * 1.2))}
        >
          <ZoomIn size={15} />
        </button>
        <button
          title="Повернуть страницу PDF"
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          <RotateCw size={15} />
        </button>
        <button
          title="Открыть PDF в системном приложении"
          onClick={() => void api().openAttachment(path)}
        >
          <ExternalLink size={15} />
        </button>
        <button
          title="Скопировать ссылку на страницу PDF"
          onClick={() =>
            void api()
              .copyText("[[" + path + "#page=" + page + "]]")
              .catch(() => setError("Не удалось скопировать ссылку"))
          }
        >
          <Copy size={15} />
        </button>
      </div>
      <form
        className="pdf-search"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <input
          aria-label="Найти в PDF"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={!pdf || searching}>
          <Search size={13} />
          {searching ? "Ищем…" : "Найти"}
        </button>
        {matches.length > 0 && (
          <select
            aria-label="Страницы с совпадениями PDF"
            value={matches.includes(page) ? page : ""}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {!matches.includes(page) && <option value="">Страница с совпадением</option>}
            {matches.map((value) => (
              <option value={value} key={value}>
                Стр. {value}
              </option>
            ))}
          </select>
        )}
      </form>
      {passwordRequest && (
        <form
          className="pdf-password"
          onSubmit={(event) => {
            event.preventDefault();
            passwordRequest.respond(password);
            setPasswordRequest(null);
            setPassword("");
            setBusy(true);
          }}
        >
          <label>
            {passwordRequest.incorrect ? "Пароль не подошёл" : "PDF защищён паролем"}
            <input
              autoFocus
              aria-label="Пароль PDF"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button>Открыть PDF</button>
        </form>
      )}
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {busy && !error && (
        <small role="status" className="pdf-loading" data-render-pending>
          Загружаем PDF…
        </small>
      )}
      <div className="pdf-page-scroll">
        <div className="pdf-page" style={{ "--scale-factor": scale } as CSSProperties}>
          <canvas ref={canvas} aria-label={"Страница " + page} />
          <div ref={text} className="textLayer" />
        </div>
      </div>
    </div>
  );
}
