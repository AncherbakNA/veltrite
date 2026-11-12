import { useEffect, useRef, useState } from "react";
import { api } from "../useVault";
export default function WebCard({ url }: { url: string }) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true,
      opened = false,
      previous = "";
    const cardId = crypto.randomUUID();
    api()
      .webCardOpen(cardId, url)
      .then(() => {
        if (alive) opened = true;
        else
          void api()
            .webCardClose(cardId)
            .catch(() => {});
      })
      .catch((error) => {
        if (alive) {
          setError(error.message);
          setOpen(false);
        }
      });
    const update = () => {
      if (!opened || !host.current) return;
      const rect = host.current.getBoundingClientRect(),
        canvas = host.current.closest(".canvas-view")?.getBoundingClientRect();
      const top = Math.max(
          rect.top,
          (canvas?.top || 0) +
            (host.current
              .closest(".canvas-view")
              ?.querySelector(".canvas-topbar")
              ?.getBoundingClientRect().height || 0),
        ),
        left = Math.max(rect.left, canvas?.left || 0),
        right = Math.min(rect.right, canvas?.right || window.innerWidth),
        bottom = Math.min(rect.bottom, canvas?.bottom || window.innerHeight);
      const overlay = document.querySelector(
        '[role="dialog"], .settings-overlay, .prompt-overlay, .command-overlay, .slides-overlay',
      );
      const bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        visible:
          !overlay &&
          right > left &&
          bottom > top &&
          document.visibilityState === "visible",
      };
      const key = JSON.stringify(bounds);
      if (key !== previous) {
        previous = key;
        void api()
          .webCardBounds(cardId, bounds)
          .catch(() => {});
      }
    };
    const timer = setInterval(update, 80);
    return () => {
      alive = false;
      clearInterval(timer);
      void api()
        .webCardClose(cardId)
        .catch(() => {});
    };
  }, [open, url]);
  return (
    <div className="canvas-web-card" onPointerDown={(event) => event.stopPropagation()}>
      <div className="web-card-bar">
        <button title={url} onClick={() => void api().openExternal(url)}>
          {url}
        </button>
        <button
          onClick={() => {
            setError("");
            setOpen((v) => !v);
          }}
        >
          {open ? "Скрыть" : "Открыть здесь"}
        </button>
      </div>
      <div className="web-card-host" ref={host}>
        {!open && <p>{error || "Страница загружается по нажатию"}</p>}
      </div>
    </div>
  );
}
