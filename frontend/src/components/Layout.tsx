import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  GitBranch,
  BarChart3,
  UsersRound,
  Search,
  ListOrdered,
  Plug,
  ShieldCheck,
  MessageSquare,
  SlidersHorizontal,
  Zap,
  Brain,
  FormInput,
  CalendarDays,
  MailOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ChatWidget } from '@/components/ChatWidget';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, group: 'Workspace' },
  { name: 'Leads', href: '/leads', icon: Users, group: 'Workspace' },
  { name: 'Pipelines', href: '/pipelines', icon: GitBranch, group: 'Workspace' },
  { name: 'Automation', href: '/automation/rules', icon: Zap, group: 'Automation' },
  { name: 'Campaigns', href: '/campaigns', icon: FileText, group: 'Automation' },
  { name: 'Content', href: '/outreach/sequences', icon: ListOrdered, group: 'Automation' },
  { name: 'Templates', href: '/templates', icon: MessageSquare, group: 'Automation' },
  { name: 'Web Forms', href: '/forms', icon: FormInput, group: 'Automation' },
  { name: 'Scheduling', href: '/scheduling', icon: CalendarDays, group: 'Automation' },
  { name: 'Reports', href: '/reports', icon: BarChart3, group: 'Intelligence' },
  { name: 'Team Dashboard', href: '/team-dashboard', icon: UsersRound, group: 'Intelligence' },
  { name: 'Scrapers', href: '/scraper', icon: Search, group: 'Intelligence' },
  { name: 'Newsletter', href: '/newsletter', icon: MailOpen, group: 'Intelligence' },
  { name: 'Settings', href: '/settings', icon: Settings, group: 'Admin' },
  { name: 'Custom Fields', href: '/settings/custom-fields', icon: SlidersHorizontal, group: 'Admin' },
  { name: 'AI & Testing', href: '/admin/ai-decisions', icon: Brain, group: 'Admin' },
];

function isRouteActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  const activeItem = navigation.find((item) => isRouteActive(location.pathname, item.href));
  const grouped = navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 text-slate-950">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 ease-out lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <Link to="/" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-950">CRM Automation</span>
              <span className="block text-xs text-slate-500">Operations console</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-5 last:mb-0">
              <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</p>
              <div className="mt-2 space-y-1">
                {items.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    end={item.href === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'group flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-slate-950 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-slate-400')} />
                        <span className="truncate">{item.name}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
                <p className="truncate text-xs capitalize text-slate-500">{user?.role}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                aria-label="Sign out"
                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-white hover:text-red-600"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open sidebar"
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{activeItem?.name ?? 'CRM'}</p>
              <p className="hidden text-xs text-slate-500 sm:block">Lead capture, nurture, pipeline, and reporting</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 sm:flex">
              <Plug className="h-3.5 w-3.5" />
              Sprint 4 active
            </div>
            <span className="hidden text-sm text-slate-500 md:block">{user?.email}</span>
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 md:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      <ChatWidget />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
