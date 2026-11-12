import { useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { frontmatter, resolveLink } from "../../shared/markdown";
import { maskMarkdownComments } from "../../shared/markdown-comments";
import type { NoteIndex } from "../../shared/types";
import { scrollWithinMarkdown } from "../navigation";
import { api } from "../useVault";
import { VaultFilesContext } from "../VaultContext";
import Embedded from "./Embedded";
import { EmbeddingRoot } from "./EmbeddingContext";
import InlineBase from "./InlineBase";
import { markdownAnchors } from "./markdownAnchors";
import {
  MarkdownBlockquote,
  MarkdownCheckbox,
  markdownHeadings,
  MarkdownListItem,
  MarkdownTaskChange,
} from "./MarkdownElements";
import {
  markdownPresentation,
  markdownTaskPositions,
  readingHighlights,
} from "./markdownPresentation";
import { MarkdownRevision } from "./MarkdownRevision";
import NoteLink from "./NoteLink";
import SafeImage from "./SafeImage";
import { useReadingFind } from "./useReadingFind";
export { assetUrl } from "../assets";
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
                  alt: match[3] || "",
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
    <pre data-render-pending={(!error && !svg) || undefined}>
      <code>{code}</code>
      {error && <small>{error}</small>}
    </pre>
  ) : (
    <span className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
export default function Markdown({
  content,
  path,
  index,
  onLink,
  depth = 0,
  onTaskChange,
}: {
  content: string;
  path: string;
  index: NoteIndex[];
  onLink: (target: string) => void;
  depth?: number;
  onTaskChange?: (offset: number, checked: boolean) => void;
}) {
  const paths = useContext(VaultFilesContext);
  const { body } = frontmatter(content);
  const source = useMemo(() => maskMarkdownComments(body), [body]);
  const host = useRef<HTMLDivElement>(null);
  const find = useReadingFind(host, depth === 0);
  const highlight = useMemo(() => readingHighlights(find.query), [find.query]);
  const revision = useMemo(() => ({ content, query: find.query }), [content, find.query]);
  const renderData = useRef({ path, index, paths, onLink, depth });
  renderData.current = { path, index, paths, onLink, depth };
  const components = useMemo<import("react-markdown").Components>(
    () => ({
      ...markdownHeadings,
      blockquote: MarkdownBlockquote,
      li: MarkdownListItem,
      input: MarkdownCheckbox,
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
        const { path, index, onLink } = renderData.current;
        if (href?.startsWith("#vlt:")) {
          const target = decodeURIComponent(href.slice(5));
          return (
            <NoteLink target={target} from={path} index={index} onOpen={onLink}>
              {children}
            </NoteLink>
          );
        }
        if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#"))
          return (
            <NoteLink target={href} from={path} index={index} onOpen={onLink}>
              {children}
            </NoteLink>
          );
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              if (href?.startsWith("#"))
                scrollWithinMarkdown(event.currentTarget, href.slice(1));
              else if (/^https?:/.test(href || "")) api().openExternal(href!);
              else if (href) onLink(href);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }) => {
        const { path, index, paths, onLink, depth } = renderData.current;
        return src?.startsWith("#embed:") ? (
          <Embedded
            target={decodeURIComponent(src.slice(7))}
            from={path}
            index={index}
            onLink={onLink}
            depth={depth}
            width={
              /^\d+(?:x\d+)?$/.test(alt || "")
                ? Math.min(4000, Number(alt!.split("x")[0]))
                : undefined
            }
            height={
              /^\d+x\d+$/.test(alt || "")
                ? Math.min(4000, Number(alt!.split("x")[1]))
                : undefined
            }
          />
        ) : (
          <SafeImage
            alt={alt || ""}
            path={
              /^https?:/i.test(src || "")
                ? src!
                : resolveLink(src || "", path, paths, index) ||
                  (src || "").replace(/^\.\//, "")
            }
          />
        );
      },
      pre: ({ node, children, ...props }) =>
        node?.children?.some((child: any) =>
          child.properties?.className?.includes("language-base"),
        ) ? (
          <div className="inline-base">{children}</div>
        ) : (
          <pre {...props}>{children}</pre>
        ),
      code: ({ className, children, ...props }) =>
        className === "language-base" ? (
          <InlineBase
            content={String(children)}
            path={renderData.current.path}
            index={renderData.current.index}
            onLink={renderData.current.onLink}
          />
        ) : className === "language-mermaid" ? (
          <Diagram code={String(children)} />
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        ),
    }),
    [],
  );
  return (
    <EmbeddingRoot path={path}>
      <MarkdownRevision.Provider value={revision}>
        <MarkdownTaskChange.Provider
          value={
            onTaskChange
              ? (offset, checked) =>
                  onTaskChange(content.length - body.length + offset, checked)
              : undefined
          }
        >
          <div
            ref={host}
            className="markdown markdown-preview-view markdown-rendered"
            data-markdown-path={path}
          >
            {find.bar}
            <ReactMarkdown
              remarkPlugins={[
                remarkGfm,
                remarkMath,
                markdownPresentation,
                markdownTaskPositions,
                wikiLinks,
                markdownAnchors,
              ]}
              rehypePlugins={[rehypeKatex, highlight]}
              urlTransform={(url) =>
                url.startsWith("#vlt:") || url.startsWith("#embed:")
                  ? url
                  : defaultUrlTransform(url)
              }
              components={components}
            >
              {source}
            </ReactMarkdown>
          </div>
        </MarkdownTaskChange.Provider>
      </MarkdownRevision.Provider>
    </EmbeddingRoot>
  );
}
