import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  { name: 'Decision Log', href: '/admin/ai-decisions' },
  { name: 'A/B Testing', href: '/ab-testing' },
] as const;

/**
 * Tab strip for the AI & Testing section — mirrors {@link ContentTabs}. A/B Testing has
 * no sidebar entry of its own, so this strip is how it stays reachable.
 */
export function AdminToolsTabs() {
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex gap-6">
        {TABS.map((tab) => (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
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
