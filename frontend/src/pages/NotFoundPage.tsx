import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm">
          <FileQuestion className="h-8 w-8" />
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">Page not found</h1>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button asChild className="mt-6">
          <Link to="/">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
