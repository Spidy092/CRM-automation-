import { Skeleton } from './Skeleton';

interface LoadingTableProps {
  rows?: number;
  cols?: number;
}

export function LoadingTable({ rows = 5, cols = 7 }: LoadingTableProps) {
  const columns = Array.from({ length: cols });

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex gap-4 pb-2">
        {columns.map((_, i) => (
          <Skeleton key={i} className={`${i === cols - 1 ? 'ml-auto ' : ''}h-4 w-24`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-t pt-3">
          <div className="flex w-32 flex-col gap-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          {columns.slice(1, -1).map((_, col) => (
            <Skeleton key={col} className="h-4 w-24" />
          ))}
          <div className="ml-auto flex gap-1">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
