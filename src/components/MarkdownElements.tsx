import { createContext, useContext, type ReactNode } from "react";
import Callout from "./Callout";
import ReadingHeading from "./ReadingHeading";
import ReadingTask, { TaskContext } from "./ReadingTask";
export const MarkdownTaskChange = createContext<
  ((offset: number, checked: boolean) => void) | undefined
>(undefined);
// Stable component identities keep folds, checkbox focus and selection during edits/search.
export const markdownHeadings = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((level) => [
    "h" + level,
    ({ id, children }: { id?: string; children?: ReactNode }) => (
      <ReadingHeading level={level} id={id}>
        {children}
      </ReadingHeading>
    ),
  ]),
);
export function MarkdownBlockquote({
  node,
  children,
}: {
  node?: any;
  children?: ReactNode;
}) {
  return node?.properties?.["data-callout"] ? (
    <Callout
      key={
        String(node.properties["data-callout-title"]) +
        String(node.properties["data-callout-fold"])
      }
      kind={String(node.properties["data-callout"])}
      title={String(node.properties["data-callout-title"])}
      fold={String(node.properties["data-callout-fold"] || "")}
    >
      {children}
    </Callout>
  ) : (
    <blockquote>{children}</blockquote>
  );
}
export function MarkdownListItem({
  node,
  children,
  ...props
}: {
  node?: any;
  children?: ReactNode;
  className?: string;
}) {
  const raw = node?.properties?.["data-task-offset"],
    offset = raw === undefined ? null : Number(raw);
  return (
    <li {...props}>
      <TaskContext.Provider
        value={{
          offset: offset !== null && Number.isInteger(offset) ? offset : null,
          label: String(node?.properties?.["data-task-label"] || "Задача"),
        }}
      >
        {children}
      </TaskContext.Provider>
    </li>
  );
}
export function MarkdownCheckbox({ checked }: { checked?: boolean }) {
  return <ReadingTask checked={checked} onChange={useContext(MarkdownTaskChange)} />;
}
