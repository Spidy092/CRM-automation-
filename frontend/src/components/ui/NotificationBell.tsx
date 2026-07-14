import { useState, useCallback } from 'react';
import { Bell, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSSE, type AppNotification } from '@/hooks/useSSE';

const MAX_NOTIFICATIONS = 20;

const TYPE_STYLES: Record<AppNotification['type'], { dot: string; label: string }> = {
  lead_assigned: { dot: 'bg-indigo-500', label: 'Lead assigned' },
  campaign_enrolled: { dot: 'bg-emerald-500', label: 'Campaign' },
  export_ready: { dot: 'bg-blue-500', label: 'Export ready' },
  job_failed: { dot: 'bg-red-500', label: 'Job failed' },
  scraper_complete: { dot: 'bg-amber-500', label: 'Scraper' },
  lead_scored: { dot: 'bg-violet-500', label: 'Lead scored' },
};

function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function leadHref(n: AppNotification): string | null {
  const leadId = n.data?.leadId as string | undefined;
  if (!leadId) return null;
  if (n.type === 'lead_assigned' || n.type === 'campaign_enrolled') return `/leads/${leadId}`;
  return null;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const handleNotification = useCallback((n: AppNotification) => {
    setNotifications((prev) => {
      const next = [n, ...prev.filter((x) => x.id !== n.id)].slice(0, MAX_NOTIFICATIONS);
      return next;
    });
    setUnreadCount((c) => c + 1);
  }, []);

  useSSE(handleNotification);

  const handleOpen = () => {
    setOpen((o) => !o);
    if (!open) setUnreadCount(0);
  };

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Notifications"
        className="relative rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-11 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNotifications([])}
                  className="text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear all
                </button>
              )}
            </div>

            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-50">
              {notifications.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-slate-400">
                  No notifications yet
                </li>
              )}
              {notifications.map((n) => {
                const href = leadHref(n);
                const style = TYPE_STYLES[n.type] ?? { dot: 'bg-slate-400', label: n.type };
                return (
                  <li key={n.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        {style.label}
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-900 leading-snug">
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500 leading-snug line-clamp-2">
                        {n.message}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">{timeAgo(n.timestamp)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {href && (
                        <Link
                          to={href}
                          onClick={() => setOpen(false)}
                          className="rounded p-1 text-slate-400 hover:text-slate-700"
                          aria-label="View"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => dismiss(n.id)}
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                        aria-label="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
