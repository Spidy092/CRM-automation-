import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  metrics?: Array<{ label: string; value: string | number; tone?: 'default' | 'success' | 'warning' | 'danger' }>;
}

const metricTone = {
  default: 'text-slate-900',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

export function PageHeader({ title, description, eyebrow, actions, metrics }: PageHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</p>
          )}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {title}
          </h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {metrics && metrics.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{metric.label}</p>
              <p className={`mt-1 text-xl font-semibold ${metricTone[metric.tone ?? 'default']}`}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
