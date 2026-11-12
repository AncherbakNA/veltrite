import {
  Check,
  ChevronRight,
  HelpCircle,
  Info,
  Lightbulb,
  Quote,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";
export default function Callout({
  kind,
  title,
  fold,
  children,
}: {
  kind: string;
  title: string;
  fold: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(fold !== "-");
  const Icon = /warning|caution|danger|failure|bug/.test(kind)
    ? TriangleAlert
    : /tip|hint/.test(kind)
      ? Lightbulb
      : /success|check/.test(kind)
        ? Check
        : /question|help/.test(kind)
          ? HelpCircle
          : kind === "quote"
            ? Quote
            : Info;
  return (
    <aside className={"callout callout-" + kind} data-callout={kind}>
      {fold ? (
        <button
          className="callout-title"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight size={14} className={open ? "expanded" : ""} />
          <Icon size={17} />
          <strong>{title}</strong>
        </button>
      ) : (
        <div className="callout-title">
          <Icon size={17} />
          <strong>{title}</strong>
        </div>
      )}
      <div className="callout-content" hidden={!open}>
        {children}
      </div>
    </aside>
  );
}
