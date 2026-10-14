import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  { name: 'Sequences', href: '/outreach/sequences' },
  { name: 'Files', href: '/files' },
  { name: 'Landing pages', href: '/pages' },
] as const;

/** Tab strip shared by the Content section (Sequences/Files/Pages). */
export function ContentTabs() {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <nav className="-mb-px flex gap-6">
        {TABS.map((tab) => (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-indigo-600 dark:border-indigo-400 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200',
              )
            }
          >
            {tab.name}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
