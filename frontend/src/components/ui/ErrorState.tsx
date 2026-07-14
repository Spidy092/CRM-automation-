import { AlertCircle } from 'lucide-react';
import { Button } from './button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50/50 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-red-200 bg-white text-red-500 shadow-sm">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{message}</p>
      {onRetry && (
        <div className="mt-5">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
