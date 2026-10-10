import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Bell,
  X,
  ExternalLink,
  CheckCheck,
  Loader2,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSSE } from '@/hooks/useSSE';
import {
  useNotifications,
  useUnreadCount,
  useMarkRead,
  useMarkAllRead,
  useDismiss,
  useInvalidateOnLiveEvent,
  useClearNotificationsOnLogout,
} from '@/hooks/useNotifications';
import type { NotificationDto } from '@/api/notifications';

const TYPE_STYLES: Record<NotificationDto['type'], { dot: string; label: string }> = {
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

function resolveNotificationHref(n: NotificationDto): string | null {
  const deepLink = n.metadata?.deepLink;
  if (typeof deepLink === 'string' && deepLink.startsWith('/') && !deepLink.startsWith('//')) {
    return deepLink;
  }
  const leadId = n.metadata?.leadId;
  if (typeof leadId === 'string' && leadId) {
    if (n.type === 'lead_assigned' || n.type === 'campaign_enrolled' || n.type === 'lead_scored') {
      return `/leads/${leadId}`;
    }
  }
  const campaignId = n.metadata?.campaignId;
  if (typeof campaignId === 'string' && campaignId) {
    return `/campaigns/${campaignId}`;
  }
  return null;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Evict notification cache on logout or user switch
  useClearNotificationsOnLogout();

  // TanStack Query server state
  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useNotifications({ excludeDismissed: true, limit: 20 });

  const { data: unreadCount = 0 } = useUnreadCount();
  const markReadMutation = useMarkRead();
  const markAllReadMutation = useMarkAllRead();
  const dismissMutation = useDismiss();

  // Reconcile on live SSE events: invalidates queries in TanStack Query cache
  const invalidateQueries = useInvalidateOnLiveEvent();
  const handleLiveEvent = useCallback(() => {
    invalidateQueries();
  }, [invalidateQueries]);

  const handleReconnect = useCallback(() => {
    invalidateQueries();
  }, [invalidateQueries]);

  const { status, reconnect } = useSSE(handleLiveEvent, handleReconnect);

  const notifications = data?.pages.flatMap((page) => page.items) ?? [];

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(new Date().toISOString());
  };

  const handleItemClick = (n: NotificationDto) => {
    if (!n.readAt) {
      markReadMutation.mutate(n.id);
    }
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dismissMutation.mutate(id);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
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
          <div
            role="dialog"
            aria-label="Notifications panel"
            className="absolute right-0 top-11 z-40 w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</p>
                {status === 'disconnected' && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 cursor-pointer dark:bg-amber-950/50 dark:text-amber-400"
                    title="Live stream disconnected. Click to reconnect."
                    onClick={reconnect}
                    role="button"
                    tabIndex={0}
                  >
                    <WifiOff className="h-2.5 w-2.5" />
                    Offline
                  </span>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={markAllReadMutation.isPending}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            {/* Content states */}
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                  <p className="mt-2 text-xs">Loading notifications...</p>
                </div>
              )}

              {isError && (
                <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Failed to load notifications</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Try again
                  </button>
                </div>
              )}

              {!isLoading && !isError && notifications.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
                  <Bell className="h-8 w-8 stroke-1 text-slate-300 dark:text-slate-600" />
                  <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">No notifications yet</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">You're completely caught up!</p>
                </div>
              )}

              {!isLoading &&
                !isError &&
                notifications.map((n) => {
                  const href = resolveNotificationHref(n);
                  const style = TYPE_STYLES[n.type] ?? { dot: 'bg-slate-400', label: n.type };
                  const isUnread = !n.readAt;

                  return (
                    <div
                      key={n.id}
                      onClick={() => handleItemClick(n)}
                      className={cn(
                        'group flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer',
                        isUnread
                          ? 'bg-slate-50/70 hover:bg-slate-100/70 dark:bg-slate-800/40 dark:hover:bg-slate-800/70'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/30',
                      )}
                    >
                      <span
                        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot, {
                          'ring-2 ring-indigo-400/40': isUnread,
                        })}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide dark:text-slate-400">
                            {style.label}
                          </p>
                          {isUnread && (
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                          )}
                        </div>
                        <p
                          className={cn(
                            'mt-0.5 text-sm leading-snug',
                            isUnread
                              ? 'font-semibold text-slate-950 dark:text-slate-50'
                              : 'font-normal text-slate-700 dark:text-slate-300',
                          )}
                        >
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 leading-snug line-clamp-2 dark:text-slate-400">
                          {n.message}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {href && (
                          <Link
                            to={href}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleItemClick(n);
                              setOpen(false);
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            aria-label="View details"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleDismiss(e, n.id)}
                          disabled={dismissMutation.isPending}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                          aria-label="Dismiss notification"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

              {hasNextPage && (
                <div className="p-2 text-center border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="w-full py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {isFetchingNextPage ? 'Loading more...' : 'Load older notifications'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
