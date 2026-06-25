import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm">
        {icon}
      </div>
      <p className="mt-4 text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
