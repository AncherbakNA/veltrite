import { ChevronRight } from "lucide-react";
import {
  createElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MarkdownRevision } from "./MarkdownRevision";
const owners = new WeakMap<HTMLElement, Set<symbol>>();
export default function ReadingHeading({
  level,
  id,
  children,
}: {
  level: number;
  id?: string;
  children: ReactNode;
}) {
  const revision = useContext(MarkdownRevision);
  const textId = useId();
  const host = useRef<HTMLHeadingElement>(null),
    owner = useRef(Symbol()),
    [folded, setFolded] = useState(false);
  useLayoutEffect(() => {
    if (!folded) return;
    const affected: HTMLElement[] = [];
    let element = host.current?.nextElementSibling as HTMLElement | null;
    while (
      element &&
      !(/^H[1-6]$/.test(element.tagName) && Number(element.tagName[1]) <= level)
    ) {
      const values = owners.get(element) || new Set();
      values.add(owner.current);
      owners.set(element, values);
      element.hidden = true;
      affected.push(element);
      element = element.nextElementSibling as HTMLElement | null;
    }
    return () => {
      for (const element of affected) {
        const values = owners.get(element);
        values?.delete(owner.current);
        element.hidden = !!values?.size;
      }
    };
  }, [folded, level, children, revision]);
  return createElement(
    "h" + level,
    { id, ref: host, className: "collapsible-heading", "aria-labelledby": textId },
    <button
      className="heading-fold"
      aria-label={(folded ? "Развернуть" : "Свернуть") + " раздел"}
      aria-expanded={!folded}
      onClick={() => setFolded((value) => !value)}
    >
      <ChevronRight size={13} className={!folded ? "expanded" : ""} />
    </button>,
    <span id={textId}>{children}</span>,
  );
}
