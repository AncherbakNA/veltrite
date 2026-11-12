import { ExternalLink } from "lucide-react";
import { lazy, Suspense } from "react";
import { assetUrl } from "../assets";
import { api } from "../useVault";
import SafeImage from "./SafeImage";
const PdfViewer = lazy(() => import("./PdfViewer"));
export default function MediaView({ path }: { path: string }) {
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  if (extension === "pdf")
    return (
      <Suspense fallback={<small data-render-pending>Загружаем PDF…</small>}>
        <PdfViewer path={path} />
      </Suspense>
    );
  return (
    <div className="media-view">
      <div className="media-actions">
        <button onClick={() => void api().openAttachment(path)}>
          <ExternalLink size={14} />
          Открыть в системном приложении
        </button>
      </div>
      {/^(png|jpe?g|webp|gif|avif|bmp)$/.test(extension) ? (
        <SafeImage path={path} />
      ) : /^(mp3|wav|ogg|webm|m4a|flac)$/.test(extension) ? (
        <audio controls src={assetUrl(path)} />
      ) : /^(mp4|mov)$/.test(extension) ? (
        <video controls src={assetUrl(path)} />
      ) : (
        <p>{path}</p>
      )}
    </div>
  );
}
