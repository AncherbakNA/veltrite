import { lazy, Suspense, useContext } from "react";
import type { NoteIndex } from "../../shared/types";
import { VaultRuntimeContext } from "../VaultContext";
import DocumentBoundary from "./DocumentBoundary";
const Bases = lazy(() => import("./Bases"));
export default function InlineBase({
  content,
  path,
  index,
  onLink,
}: {
  content: string;
  path: string;
  index: NoteIndex[];
  onLink: (target: string) => void;
}) {
  const runtime = useContext(VaultRuntimeContext);
  return (
    <DocumentBoundary onSource={() => {}}>
      <Suspense fallback={<small data-render-pending>Загружаем базу…</small>}>
        <Bases
          readOnlyDefinition
          content={content}
          path={path}
          contextPath={path}
          files={runtime.files}
          index={index}
          types={runtime.types}
          onChange={() => {}}
          beforePropertyChange={runtime.flush}
          onOpen={onLink}
          onLink={onLink}
        />
      </Suspense>
    </DocumentBoundary>
  );
}
