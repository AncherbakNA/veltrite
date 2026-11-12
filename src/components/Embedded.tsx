import { lazy, Suspense, useContext, useEffect, useId, useState } from "react";
import { relativeLink } from "../../shared/links";
import { resolveLink } from "../../shared/markdown";
import { decodeFragment, noteFragment } from "../../shared/markdown-blocks";
import type { NoteIndex } from "../../shared/types";
import { assetUrl } from "../assets";
import { api } from "../useVault";
import { VaultFilesContext, VaultRuntimeContext } from "../VaultContext";
import DocumentBoundary from "./DocumentBoundary";
import { EmbeddingBudgetContext, EmbeddingContext } from "./EmbeddingContext";
import Markdown from "./Markdown";
import SafeImage from "./SafeImage";
const Bases = lazy(() => import("./Bases")),
  Canvas = lazy(() => import("./Canvas")),
  PdfViewer = lazy(() => import("./PdfViewer"));
export default function Embedded({
  target,
  from,
  index,
  onLink,
  depth = 0,
  width,
  height,
}: {
  target: string;
  from: string;
  index: NoteIndex[];
  onLink: (target: string, from?: string) => void;
  depth?: number;
  width?: number;
  height?: number;
}) {
  const known = useContext(VaultFilesContext),
    runtime = useContext(VaultRuntimeContext),
    parents = useContext(EmbeddingContext),
    budget = useContext(EmbeddingBudgetContext),
    instance = useId(),
    paths = known.length ? known : index.map((note) => note.path),
    resolved = resolveLink(target, from, paths, index),
    recursive =
      !!resolved && (parents.includes(resolved) || parents.length >= 8 || depth >= 8),
    [loaded, setNote] = useState<{
      path: string;
      content: string;
      revision: string;
    } | null>(null),
    [reservation, setReservation] = useState<{ path: string; allowed: boolean } | null>(
      null,
    ),
    [error, setError] = useState("");
  const extension = resolved?.split(".").at(-1)?.toLowerCase() || "",
    note = loaded?.path === resolved ? loaded : null;
  useEffect(() => {
    let alive = true;
    setError("");
    if (!resolved || recursive) return;
    const category = ["pdf", "base", "canvas"].includes(extension) ? extension : "note",
      maximum =
        category === "pdf" || category === "canvas" ? 4 : category === "base" ? 8 : 100;
    const slots = budget?.get(category) || new Set<string>();
    if (slots.size >= maximum) {
      setReservation({ path: resolved, allowed: false });
      return;
    }
    budget?.set(category, slots);
    slots.add(instance);
    setReservation({ path: resolved, allowed: true });
    if (/\.(md|base|canvas)$/i.test(resolved))
      api()
        .read(resolved)
        .then((value) => {
          if (alive)
            setNote((previous) =>
              previous?.path === value.path && previous.revision === value.revision
                ? previous
                : value,
            );
        })
        .catch(() => {
          if (alive) setError("Не удалось прочитать вложение");
        });
    return () => {
      alive = false;
      slots.delete(instance);
    };
  }, [resolved, recursive, index, extension, budget, instance]);
  const navigate = (target: string, source = from) => {
    const destination = resolveLink(target, source, paths, index);
    onLink(
      destination
        ? relativeLink(from, destination) +
            (target.includes("#") ? target.slice(target.indexOf("#")) : "")
        : target,
    );
  };
  if (!resolved)
    return (
      <button className="inline-link" onClick={() => navigate(target, from)}>
        {target} · файл не найден
      </button>
    );
  const open = () => navigate(target, from);
  if (recursive)
    return (
      <button className="inline-link" onClick={open}>
        {resolved} · повторное вложение
      </button>
    );
  if (reservation?.path !== resolved)
    return <small data-render-pending>Загружаем вложение…</small>;
  if (!reservation.allowed)
    return (
      <button className="inline-link" onClick={open}>
        {resolved} · открыть отдельно
      </button>
    );
  if (/^(png|jpe?g|webp|gif|avif|bmp)$/.test(extension || ""))
    return <SafeImage path={resolved} alt={resolved} width={width} height={height} />;
  if (/^(mp3|wav|ogg|webm|m4a|flac)$/.test(extension || ""))
    return <audio controls preload="metadata" src={assetUrl(resolved)} />;
  if (/^(mp4|mov)$/.test(extension || ""))
    return (
      <video
        controls
        preload="metadata"
        src={assetUrl(resolved)}
        width={width}
        height={height}
      />
    );
  if (extension === "pdf")
    return (
      <Suspense fallback={<small data-render-pending>Загружаем PDF…</small>}>
        <PdfViewer
          path={resolved}
          fragment={target.includes("#") ? target.slice(target.indexOf("#")) : ""}
        />
      </Suspense>
    );
  if (!["md", "base", "canvas"].includes(extension || ""))
    return (
      <button className="inline-link" onClick={open}>
        {resolved}
      </button>
    );
  return (
    <div
      className={"embed-content" + (extension === "md" ? " embed-note" : "")}
      data-embed-target={resolved}
    >
      <button className="embed-title" onClick={open}>
        {resolved.replace(/\.md$/i, "")}
      </button>
      {error ? (
        <p>{error}</p>
      ) : !note ? (
        <small data-render-pending>Загружаем вложение…</small>
      ) : (
        <DocumentBoundary onSource={open}>
          <Suspense fallback={<small data-render-pending>Загружаем вложение…</small>}>
            {extension === "md" ? (
              <Markdown
                content={noteFragment(note.content, target) ?? "Фрагмент не найден"}
                path={resolved}
                index={index}
                onLink={(link) => navigate(link, resolved)}
                depth={depth + 1}
              />
            ) : extension === "base" ? (
              <Bases
                readOnlyDefinition
                path={resolved}
                contextPath={from}
                content={note.content}
                index={index}
                files={runtime.files}
                types={runtime.types}
                onOpen={(path) => navigate(path, "")}
                onLink={(link, source) => navigate(link, source)}
                beforePropertyChange={runtime.flush}
                initialView={target.includes("#") ? decodeFragment(target) : undefined}
                onChange={() => {}}
              />
            ) : (
              <Canvas
                path={resolved}
                content={note.content}
                readOnly
                onChange={() => {}}
                index={index}
                onOpen={(link, source = resolved) => navigate(link, source)}
                onChooseFile={() => {}}
                onChooseLink={() => {}}
              />
            )}
          </Suspense>
        </DocumentBoundary>
      )}
    </div>
  );
}
