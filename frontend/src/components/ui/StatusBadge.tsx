import { cn } from '@/lib/utils';

const toneClasses = {
  gray: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  green: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60',
  blue: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  amber: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800/60',
  red: 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-800/60',
  violet: 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800/60',
  cyan: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 ring-cyan-200 dark:ring-cyan-800/60',
};

export type StatusTone = keyof typeof toneClasses;

export function StatusBadge({
  children,
  tone = 'gray',
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium capitalize ring-1 ring-inset',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
