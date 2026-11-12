import { Image as ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../assets";
import { api } from "../useVault";
export default function SafeImage({
  path,
  alt = "",
  width,
  height,
}: {
  path: string;
  alt?: string;
  width?: number;
  height?: number;
}) {
  const remote = /^https?:\/\//i.test(path),
    [data, setData] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const currentPath = useRef(path);
  currentPath.current = path;
  useEffect(() => {
    setData("");
    setError("");
    setLoading(false);
  }, [path]);
  if (remote && !data)
    return (
      <span className="remote-image">
        <button
          disabled={loading}
          onClick={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            setLoading(true);
            setError("");
            try {
              const data = await api().remoteImage(path);
              if (currentPath.current === path) setData(data);
            } catch (error: any) {
              if (currentPath.current === path) setError(error.message);
            } finally {
              if (currentPath.current === path) setLoading(false);
            }
          }}
        >
          <ImageIcon size={16} />
          {loading ? "Загружаем…" : "Загрузить изображение"}
        </button>
        <small>{alt || new URL(path).hostname}</small>
        {error && <small className="danger-text">{error}</small>}
      </span>
    );
  return (
    <img
      src={remote ? data : assetUrl(path)}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
    />
  );
}
