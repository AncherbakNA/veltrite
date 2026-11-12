import { useContext, useEffect, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { frontmatter, resolveLink } from "../../shared/markdown";
import { noteFragment } from "../../shared/markdown-blocks";
import type { NoteIndex } from "../../shared/types";
import { api } from "../useVault";
import { VaultFilesContext } from "../VaultContext";
import { markdownAnchors } from "./markdownAnchors";
import NoteLink from "./NoteLink";
export const assetUrl = (path: string) =>
  "veltrite-asset://vault/" + path.split("/").map(encodeURIComponent).join("/");
function wikiLinks() {
  return (tree: any) => {
    function walk(node: any) {
      if (["code", "inlineCode", "link", "image"].includes(node.type)) return;
      if (!node.children) return;
      node.children = node.children.flatMap((child: any) => {
        if (child.type !== "text") {
          walk(child);
          return [child];
        }
        const parts: any[] = [];
        let offset = 0;
        for (const match of child.value.matchAll(
          /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        )) {
          if (match.index > offset)
            parts.push({
              type: "text",
              value: child.value.slice(offset, match.index),
            });
          const target = match[2],
            label = match[3] || target.split("#")[0];
          parts.push(
            match[1]
              ? {
                  type: "image",
                  url: "#embed:" + encodeURIComponent(target),
                  alt: label,
                }
              : {
                  type: "link",
                  url: "#vlt:" + encodeURIComponent(target),
                  children: [{ type: "text", value: label }],
                },
          );
          offset = match.index + match[0].length;
        }
        if (offset < child.value.length)
          parts.push({ type: "text", value: child.value.slice(offset) });
        return parts.length ? parts : [child];
      });
    }
    walk(tree);
  };
}
function Diagram({ code }: { code: string }) {
  const [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.dataset.theme === "light" ? "default" : "dark",
          suppressErrorRendering: true,
        });
        const result = await mermaid.render(
          "diagram-" + crypto.randomUUID().replace(/-/g, ""),
          code,
        );
        if (alive) setSvg(result.svg);
      })
      .catch(() => {
        if (alive) setError("Не удалось построить диаграмму");
      });
    return () => {
      alive = false;
    };
  }, [code]);
  return error || !svg ? (
    <pre>
      <code>{code}</code>
      {error && <small>{error}</small>}
    </pre>
  ) : (
    <span className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
function Embedded({
  target,
  from,
  index,
  onLink,
  depth,
}: {
  target: string;
  from: string;
  index: NoteIndex[];
  onLink: (link: string) => void;
  depth: number;
}) {
  const contextPaths = useContext(VaultFilesContext),
    paths = contextPaths.length ? contextPaths : index.map((n) => n.path),
    resolved = resolveLink(target, from, paths, index),
    [content, setContent] = useState("");
  useEffect(() => {
    if (resolved && depth < 2)
      api()
        .read(resolved)
        .then((n) => setContent(n.content))
        .catch(() => {});
  }, [resolved, depth]);
  if (resolved && /\.md$/i.test(resolved))
    return (
      <span className="embed-note">
        <button onClick={() => onLink(target)}>{resolved.replace(/\.md$/i, "")}</button>
        {depth < 2 && (
          <Markdown
            content={noteFragment(content, target) ?? "Фрагмент не найден"}
            path={resolved}
            index={index}
            onLink={onLink}
            depth={depth + 1}
          />
        )}
      </span>
    );
  const relative = resolved || target.split("#")[0];
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(relative))
    return <img src={assetUrl(relative)} alt={relative} loading="lazy" />;
  if (/\.(mp3|wav|ogg|webm|m4a|flac)$/i.test(relative))
    return <audio controls src={assetUrl(relative)} />;
  if (/\.(mp4|mov)$/i.test(relative)) return <video controls src={assetUrl(relative)} />;
  return (
    <button className="inline-link" onClick={() => onLink(target)}>
      {relative}
    </button>
  );
}
export default function Markdown({
  content,
  path,
  index,
  onLink,
  depth = 0,
}: {
  content: string;
  path: string;
  index: NoteIndex[];
  onLink: (target: string) => void;
  depth?: number;
}) {
  const paths = useContext(VaultFilesContext);
  const { body } = frontmatter(content);
  const source = body.replace(
    /^(>\s*)\[!([\w-]+)\][+-]?\s*(.*)$/gm,
    (_all, prefix, kind, title) =>
      `${prefix}**${title || ({ tip: "Совет", note: "Заметка", warning: "Внимание", info: "Информация", example: "Пример", quote: "Цитата", danger: "Осторожно", success: "Готово" } as any)[kind] || kind}**`,
  );
  return (
    <div className="markdown" data-markdown-path={path}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, wikiLinks, markdownAnchors]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith("#vlt:") || url.startsWith("#embed:")
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          p: ({ node, children, ...props }) =>
            node?.children?.some(
              (child: any) =>
                child.tagName === "img" && child.properties?.src?.startsWith("#embed:"),
            ) ? (
              <div className="markdown-paragraph" {...props}>
                {children}
              </div>
            ) : (
              <p {...props}>{children}</p>
            ),
          a: ({ href, children }) => {
            if (href?.startsWith("#vlt:")) {
              const target = decodeURIComponent(href.slice(5));
              return (
                <NoteLink target={target} from={path} index={index} onOpen={onLink}>
                  {children}
                </NoteLink>
              );
            }
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  if (href?.startsWith("#"))
                    document
                      .getElementById(href.slice(1))
                      ?.scrollIntoView({
                        behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                          .matches
                          ? "auto"
                          : "smooth",
                      });
                  else if (/^https?:/.test(href || "")) api().openExternal(href!);
                  else if (href) onLink(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) =>
            src?.startsWith("#embed:") ? (
              <Embedded
                target={decodeURIComponent(src.slice(7))}
                from={path}
                index={index}
                onLink={onLink}
                depth={depth}
              />
            ) : (
              <img
                alt={alt}
                src={
                  /^https?:/i.test(src || "")
                    ? undefined
                    : assetUrl(
                        resolveLink(src || "", path, paths, index) ||
                          (src || "").replace(/^\.\//, ""),
                      )
                }
                loading="lazy"
              />
            ),
          code: ({ className, children, ...props }) =>
            className === "language-mermaid" ? (
              <Diagram code={String(children)} />
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
