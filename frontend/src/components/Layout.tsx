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
  Inbox,
  BarChart3,
  UsersRound,
  Search,
  ListOrdered,
  Plug,
  ShieldCheck,
  MessageSquare,
  Zap,
  Brain,
  FormInput,
  CalendarDays,
  MailOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/ui/NotificationBell';
import { ChatWidget } from '@/components/ChatWidget';
import { useInbox } from '@/api/aiInbox';

const navigation = [
  // Inbox leads the list: it is the surface a rep works out of every day.
  { name: 'Inbox', href: '/ai-inbox', icon: Inbox, group: 'Workspace' },
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, group: 'Workspace' },
  { name: 'Leads', href: '/leads', icon: Users, group: 'Workspace' },
  { name: 'Pipelines', href: '/pipelines', icon: GitBranch, group: 'Workspace' },
  { name: 'Campaigns', href: '/campaigns', icon: FileText, group: 'Outreach' },
  { name: 'Content', href: '/outreach/sequences', icon: ListOrdered, group: 'Outreach' },
  { name: 'Templates', href: '/templates', icon: MessageSquare, group: 'Outreach' },
  { name: 'Newsletter', href: '/newsletter', icon: MailOpen, group: 'Outreach' },
  { name: 'Trigger Rules', href: '/automation/rules', icon: Zap, group: 'Tools' },
  { name: 'Web Forms', href: '/forms', icon: FormInput, group: 'Tools' },
  { name: 'Scheduling', href: '/scheduling', icon: CalendarDays, group: 'Tools' },
  { name: 'Reports', href: '/reports', icon: BarChart3, group: 'Intelligence' },
  { name: 'Team Dashboard', href: '/team-dashboard', icon: UsersRound, group: 'Intelligence' },
  { name: 'Scrapers', href: '/scraper', icon: Search, group: 'Intelligence' },
  { name: 'Settings', href: '/settings', icon: Settings, group: 'Admin' },
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

  // Drives the Inbox badge — the count is what makes the nav item worth glancing at.
  const { data: inbox } = useInbox({ status: 'pending' });
  const pendingInboxCount = inbox?.total ?? 0;

  const activeItem = navigation.find((item) => isRouteActive(location.pathname, item.href));
  const grouped = navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] ?? []), item];
    return acc;
  }, {});

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-950 dark:text-slate-50">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-200 ease-out lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4">
          <Link to="/" className="flex items-center gap-3" onClick={() => setSidebarOpen(false)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 dark:bg-slate-50 text-white dark:text-slate-950">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-950 dark:text-slate-50">CRM Automation</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">Operations console</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="mb-5 last:mb-0">
              <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{group}</p>
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
                          ? 'bg-slate-950 dark:bg-slate-100 text-white dark:text-slate-950 shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-950 dark:hover:text-slate-50',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white dark:text-slate-950' : 'text-slate-400 dark:text-slate-500')} />
                        <span className="truncate">{item.name}</span>
                        {item.href === '/ai-inbox' && pendingInboxCount > 0 && (
                          <span
                            className={cn(
                              'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold',
                              isActive ? 'bg-white dark:bg-slate-950 text-slate-950 dark:text-white' : 'bg-indigo-600 text-white',
                            )}
                          >
                            {pendingInboxCount > 99 ? '99+' : pendingInboxCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2.5">
            <Link
              to="/account"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-700/80"
              title="My Account"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{user?.name}</p>
                <p className="truncate text-xs capitalize text-slate-500 dark:text-slate-400">{user?.role}</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="rounded-md p-2 text-slate-500 dark:text-slate-400 transition-colors hover:bg-white dark:hover:bg-slate-700 hover:text-red-600 dark:hover:text-red-400 shrink-0"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open sidebar"
              className="rounded-md p-2 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">{activeItem?.name ?? 'CRM'}</p>
              <p className="hidden text-xs text-slate-500 dark:text-slate-400 sm:block">Lead capture, nurture, pipeline, and reporting</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 sm:flex">
              <Plug className="h-3.5 w-3.5" />
              Sprint 4 active
            </div>
            <span className="hidden text-sm text-slate-500 dark:text-slate-400 md:block">{user?.email}</span>
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
