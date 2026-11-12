import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export function usePagination(total: number, scope: string, size = 200) {
  const [stored, setStored] = useState({ scope, page: 0 });
  const pages = Math.max(1, Math.ceil(total / size));
  const page = stored.scope === scope ? Math.min(stored.page, pages - 1) : 0;
  return {
    total,
    size,
    page,
    pages,
    start: page * size,
    onPage: (next: number) =>
      setStored({ scope, page: Math.max(0, Math.min(pages - 1, next)) }),
  };
}
export default function Pagination({
  total,
  size,
  page,
  pages,
  onPage,
}: ReturnType<typeof usePagination>) {
  if (total <= size) return null;
  return (
    <nav className="pagination" aria-label="Страницы списка">
      <span role="status">
        {page * size + 1}–{Math.min((page + 1) * size, total)} из {total}
      </span>
      <button
        className="icon-button"
        aria-label="Предыдущая страница"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button
        className="icon-button"
        aria-label="Следующая страница"
        disabled={page === pages - 1}
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
