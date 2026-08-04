import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZE_OPTIONS } from '@/lib/tablePrefs';

interface TablePaginationProps {
  /** Zero-based page index. */
  page: number;
  pageSize: number;
  /** Rows rendered on the current page. */
  rowCount: number;
  /** Total matching rows across all pages, when the server reports it. */
  total?: number;
  /** Server said another page exists — used when `total` is unavailable. */
  hasMore: boolean;
  isLoading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * Page-number pager for offset-paginated lists. Falls back to prev/next-only
 * behaviour when the endpoint does not return a total count.
 */
export function TablePagination({
  page,
  pageSize,
  rowCount,
  total,
  hasMore,
  isLoading = false,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const pageCount = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  const firstRow = rowCount === 0 ? 0 : page * pageSize + 1;
  const lastRow = page * pageSize + rowCount;
  const canPrev = page > 0 && !isLoading;
  const canNext = (pageCount !== undefined ? page + 1 < pageCount : hasMore) && !isLoading;

  // A short window of page buttons centred on the current page.
  const pageButtons: number[] = [];
  if (pageCount !== undefined) {
    const start = Math.max(0, Math.min(page - 2, pageCount - 5));
    const end = Math.min(pageCount, start + 5);
    for (let i = start; i < end; i += 1) pageButtons.push(i);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Rows per page
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-slate-500">
          {total !== undefined
            ? `${firstRow}–${lastRow} of ${total}`
            : `${firstRow}–${lastRow}`}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(0)}
          disabled={!canPrev}
          aria-label="First page"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>

        {pageCount !== undefined ? (
          pageButtons.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-label={`Page ${p + 1}`}
              aria-current={p === page ? 'page' : undefined}
              className={`h-8 min-w-8 rounded-md px-2 text-xs font-medium transition-colors ${
                p === page
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {p + 1}
            </button>
          ))
        ) : (
          <span className="px-2 text-xs text-slate-500">Page {page + 1}</span>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {pageCount !== undefined && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPageChange(pageCount - 1)}
            disabled={!canNext}
            aria-label="Last page"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
