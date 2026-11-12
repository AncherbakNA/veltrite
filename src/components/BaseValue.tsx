import { createElement, lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { displayBaseText, type BaseDisplayValue } from "../../shared/base-display";
import { normalizePath } from "../../shared/links";
import { api } from "../useVault";
import SafeImage from "./SafeImage";
const BaseIcon = lazy(() => import("./BaseIcons"));
interface Props {
  value: BaseDisplayValue | undefined;
  from: string;
  onOpen: (path: string) => void;
  onLink?: (target: string, from: string) => void;
}
function FormulaHtml({
  html,
  from,
  onLink,
}: Pick<Props, "from" | "onLink"> & { html: string }) {
  const nodes = useMemo(
    () => new DOMParser().parseFromString(html, "text/html").body.childNodes,
    [html],
  );
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement)) return null;
    const tag = node.tagName.toLowerCase();
    if (
      [
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "link",
        "meta",
        "svg",
      ].includes(tag)
    )
      return null;
    const children = [...node.childNodes].map((child, i) => render(child, i));
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (!href || (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)))
        return children;
      return (
        <a
          key={key}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (/^https?:\/\//i.test(href)) void api().openExternal(href);
            else onLink?.(href, from);
          }}
        >
          {children}
        </a>
      );
    }
    if (tag === "img") {
      const path = node.getAttribute("src") || "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return null;
      return (
        <SafeImage
          key={key}
          path={
            /^https?:\/\//i.test(path)
              ? path
              : normalizePath(from.split("/").slice(0, -1).join("/") + "/" + path) || path
          }
          alt={node.getAttribute("alt") || ""}
        />
      );
    }
    if (
      ![
        "b",
        "strong",
        "i",
        "em",
        "span",
        "div",
        "p",
        "br",
        "small",
        "s",
        "u",
        "mark",
        "sub",
        "sup",
        "code",
        "pre",
        "ul",
        "ol",
        "li",
        "table",
        "tbody",
        "tr",
        "th",
        "td",
      ].includes(tag)
    )
      return children;
    const color = node.style.color,
      backgroundColor = node.style.backgroundColor;
    const safe = (value: string) =>
      /^(?:#[a-f0-9]{3,8}|[a-z]{1,24}|rgba?\([\d,.%\s]+\))$/i.test(value)
        ? value
        : undefined;
    return createElement(
      tag,
      { key, style: { color: safe(color), backgroundColor: safe(backgroundColor) } },
      ...(tag === "br" ? [] : children),
    );
  };
  return (
    <span className="base-html">{[...nodes].map((node, i) => render(node, i))}</span>
  );
}
export default function BaseValue(props: Props) {
  const { value, onOpen, onLink, from } = props,
    [expanded, setExpanded] = useState(false);
  if (value == null) return <span className="faint">—</span>;
  if (value instanceof Date)
    return <time dateTime={value.toISOString()}>{displayBaseText(value)}</time>;
  if (Array.isArray(value))
    return (
      <span className="base-value-list">
        {(expanded ? value : value.slice(0, 20)).map((entry, i) => (
          <span key={i}>
            <BaseValue {...props} value={entry} />
            {i < (expanded ? value.length : Math.min(value.length, 20)) - 1 ? ", " : ""}
          </span>
        ))}
        {value.length > 20 && (
          <button className="text-link" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Свернуть" : "+" + (value.length - 20)}
          </button>
        )}
      </span>
    );
  if (typeof value !== "object") return <>{String(value)}</>;
  if (value.kind === "link" || value.kind === "url")
    return (
      <a
        href={value.kind === "url" ? value.path : "#"}
        onClick={(e) => {
          e.preventDefault();
          if (value.kind === "url") void api().openExternal(value.path);
          else if (value.resolved) onOpen(value.resolved);
          else onLink?.(value.path, value.source || from);
        }}
      >
        <BaseValue {...props} value={value.label} />
      </a>
    );
  if (value.kind === "image") return <SafeImage path={value.path} alt="" />;
  if (value.kind === "icon")
    return (
      <Suspense fallback={value.name}>
        <BaseIcon name={value.name} />
      </Suspense>
    );
  if (value.kind === "html") return <FormulaHtml {...props} html={value.html} />;
  if (value.kind === "error")
    return (
      <span className="danger-text" title={value.message}>
        ⚠ {value.message}
      </span>
    );
  return <>{displayBaseText(value)}</>;
}
