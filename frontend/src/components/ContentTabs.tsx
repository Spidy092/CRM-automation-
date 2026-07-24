import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  { name: 'Sequences', href: '/outreach/sequences' },
  { name: 'Messages', href: '/messages' },
  { name: 'Files', href: '/files' },
  { name: 'Pages', href: '/pages' },
] as const;

/** Tab strip shared by the Content section (Sequences/Messages/Files/Pages) — mirrors Privyr's Content IA. */
export function ContentTabs() {
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
