import * as React from 'react';
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Mail,
  MailCheck,
  MessageSquare,
  Phone,
  Pin,
  PinOff,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { useLeadHistoryAuthors, useLeadHistory, usePinnedNotes, useSetActivityPinned } from '@/api/leads';
import type { LeadHistoryChannel, LeadHistoryEntry, LeadHistoryKind } from '@/api/leads';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import type { ActivityType } from '@/types';

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS: Array<{ id: LeadHistoryKind; label: string }> = [
  { id: 'all', label: 'All activity' },
  { id: 'notes', label: 'Notes' },
  { id: 'messages', label: 'Messages' },
  { id: 'system', label: 'System activity' },
];

const CHANNEL_OPTIONS: Array<{ value: LeadHistoryChannel; label: string }> = [
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
];

const PREVIEW_LENGTH = 160;

/** Roles allowed to create notes — and therefore to pin/unpin them. */
function canContribute(role: string | undefined): boolean {
  return role === 'admin' || role === 'manager' || role === 'sales';
}

// ── Formatting helpers ───────────────────────────────────────────────────────

const activityTypeLabels: Record<ActivityType, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  note: 'Note',
  status_change: 'Status change',
  assignment_change: 'Assignment change',
};

function classifyActivity(type: ActivityType, metadata: Record<string, unknown>): string {
  if (type === 'status_change') {
    const from = String(metadata?.from ?? '—');
    const to = String(metadata?.to ?? '—');
    return `Status changed from ${from} to ${to}`;
  }
  if (type === 'assignment_change') {
    const from = String(metadata?.from ?? '—');
    const to = String(metadata?.to ?? '—');
    return `Assignment changed from ${from} to ${to}`;
  }
  if (type === 'note') {
    if (metadata?.outcome_label) {
      return `Outcome · ${String(metadata.outcome_label)}`;
    }
    if (metadata?.note) {
      return String(metadata.note);
    }
    return 'Note';
  }
  if (type === 'call' || type === 'whatsapp' || type === 'email') {
    const direction = String(metadata?.direction ?? '');
    return direction ? `${activityTypeLabels[type]} · ${direction}` : activityTypeLabels[type];
  }
  return activityTypeLabels[type];
}

function entryText(entry: LeadHistoryEntry): string {
  if (entry.source === 'message') {
    return entry.message_body ?? '';
  }
  return classifyActivity(
    (entry.activity_type ?? 'note') as ActivityType,
    entry.metadata ?? {},
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function readableTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isSystemEntry(entry: LeadHistoryEntry): boolean {
  return (
    entry.source === 'activity' &&
    (entry.activity_type === 'status_change' || entry.activity_type === 'assignment_change')
  );
}

// ── Date grouping ────────────────────────────────────────────────────────────

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type HistoryNode =
  | { kind: 'entry'; entry: LeadHistoryEntry }
  | { kind: 'system-group'; key: string; entries: LeadHistoryEntry[] };

/** Collapse runs of 2+ adjacent system events into expandable summaries. */
function groupSystemRuns(entries: LeadHistoryEntry[]): HistoryNode[] {
  const nodes: HistoryNode[] = [];
  let run: LeadHistoryEntry[] = [];
  const flush = () => {
    if (run.length >= 2) {
      nodes.push({ kind: 'system-group', key: `sys-${run[0].id}`, entries: run });
    } else {
      for (const entry of run) nodes.push({ kind: 'entry', entry });
    }
    run = [];
  };
  for (const entry of entries) {
    if (isSystemEntry(entry)) {
      if (run.length && dayKey(run[0].created_at) !== dayKey(entry.created_at)) flush();
      run.push(entry);
    } else {
      flush();
      nodes.push({ kind: 'entry', entry });
    }
  }
  flush();
  return nodes;
}

interface DateGroup {
  label: string;
  nodes: HistoryNode[];
}

function groupByDate(nodes: HistoryNode[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const node of nodes) {
    const newest = node.kind === 'entry' ? node.entry.created_at : node.entries[0].created_at;
    const label = dayLabel(newest);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.nodes.push(node);
    } else {
      groups.push({ label, nodes: [node] });
    }
  }
  return groups;
}

// ── Message presentation (matches the previous Message History card) ─────────

const STATUS_STYLES: Record<string, string> = {
  sent: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  opened: 'bg-purple-100 text-purple-700',
  replied: 'bg-indigo-100 text-indigo-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-slate-100 text-slate-600',
};

const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  phone_call: 'Call',
};

function EntryIcon({ entry }: { entry: LeadHistoryEntry }) {
  const cls = 'h-3.5 w-3.5';
  if (entry.source === 'message') {
    switch (entry.channel) {
      case 'email':
        return <Mail className={cls} role="img" aria-label="Email" />;
      case 'whatsapp':
        return <MessageSquare className={cls} role="img" aria-label="WhatsApp" />;
      case 'sms':
        return <MessageSquare className={cls} role="img" aria-label="SMS" />;
      default:
        return <Phone className={cls} role="img" aria-label="Call" />;
    }
  }
  switch (entry.activity_type) {
    case 'call':
      return <Phone className={cls} role="img" aria-label="Call" />;
    case 'whatsapp':
      return <MessageSquare className={cls} role="img" aria-label="WhatsApp" />;
    case 'email':
      return <Mail className={cls} role="img" aria-label="Email" />;
    case 'note':
      return <FileText className={cls} role="img" aria-label="Note" />;
    case 'status_change':
      return <ArrowRightLeft className={cls} role="img" aria-label="Status change" />;
    case 'assignment_change':
      return <UserCheck className={cls} role="img" aria-label="Assignment change" />;
    default:
      return <FileText className={cls} role="img" aria-label="Activity" />;
  }
}

function entryTitle(entry: LeadHistoryEntry): string {
  if (entry.source === 'message') {
    const channel = CHANNEL_LABELS[entry.channel ?? ''] ?? entry.channel ?? 'Message';
    return entry.step_number != null ? `${channel} · Step ${entry.step_number}` : channel;
  }
  return activityTypeLabels[(entry.activity_type ?? 'note') as ActivityType] ?? 'Activity';
}

// ── Component ────────────────────────────────────────────────────────────────

export function LeadHistory({ leadId }: { leadId: string }) {
  const role = useAuthStore((s) => s.user?.role);
  const writable = canContribute(role);

  const [tab, setTab] = React.useState<LeadHistoryKind>('all');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [channel, setChannel] = React.useState<LeadHistoryChannel | ''>('');
  const [author, setAuthor] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const olderScrollPosition = React.useRef<number | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Debounce search so each keystroke doesn't fire a server query.
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = React.useMemo(
    () => ({
      kind: tab,
      ...(search ? { search } : {}),
      ...(channel ? { channel } : {}),
      ...(author ? { author } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    }),
    [tab, search, channel, author, dateFrom, dateTo],
  );

  const history = useLeadHistory(leadId, filters);
  const pinned = usePinnedNotes(leadId);
  const authorOptions = useLeadHistoryAuthors(leadId);
  const pinnedEntries = [...new Map((pinned.data?.pages ?? []).flatMap((page) => page.items).map((entry) => [entry.id, entry])).values()];
  const setPinned = useSetActivityPinned();

  const entries = React.useMemo(() => {
    const seen = new Map<string, LeadHistoryEntry>();
    for (const page of history.data?.pages ?? []) {
      for (const entry of page.items) {
        // Belt-and-braces dedupe: the keyset cursor already guarantees stable
        // pages, but a note created mid-paging must never render twice.
        if (!seen.has(entry.id)) seen.set(entry.id, entry);
      }
    }
    return [...seen.values()];
  }, [history.data]);

  const authors = authorOptions.data ?? [];

  React.useLayoutEffect(() => {
    if (!history.isFetchingNextPage && olderScrollPosition.current !== null) {
      window.scrollTo({ top: olderScrollPosition.current, behavior: 'instant' });
      olderScrollPosition.current = null;
    }
  }, [history.data, history.isFetchingNextPage, history.isError]);

  const dateGroups = React.useMemo(
    () => groupByDate(groupSystemRuns(entries)),
    [entries],
  );

  const initialError = history.isError && entries.length === 0;
  const filtersActive = Boolean(search || channel || author || dateFrom || dateTo);

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setChannel('');
    setAuthor('');
    setDateFrom('');
    setDateTo('');
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePin = async (activityId: string, pin: boolean) => {
    try {
      await setPinned.mutateAsync({ leadId, activityId, pinned: pin });
    } catch {
      // The mutation surfaces the error state; no toast wiring here.
    }
  };

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const showPinned = (tab === 'all' || tab === 'notes') && pinnedEntries.length > 0;

  return (
    <div style={{ overflowAnchor: "none" }}>
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Lead history views"
        className="flex gap-1 overflow-x-auto border-b border-slate-200"
      >
        {TABS.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`history-panel-${t.id}`}
            id={`history-tab-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, index)}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + filters (all server-side, across the full history) */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <label className="relative sm:col-span-2 lg:min-w-52 lg:flex-1">
          <span className="sr-only">Search history</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search history…"
            aria-label="Search history"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <label className="text-sm">
          <span className="sr-only">Filter by channel</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as LeadHistoryChannel | '')}
            aria-label="Filter by channel"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:w-auto"
          >
            <option value="">All channels</option>
            {CHANNEL_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">Filter by author</span>
          <select
            disabled={authorOptions.isLoading || authorOptions.isError}
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            aria-label="Filter by author"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 lg:w-auto"
          >
            <option value="">Anyone</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name ?? 'Unknown author'}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:w-auto">
          <label className="flex flex-1 items-center gap-1.5 text-xs text-slate-500 lg:flex-none">
            From
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="History from date"
              className="min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </label>
          <label className="flex flex-1 items-center gap-1.5 text-xs text-slate-500 lg:flex-none">
            To
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="History to date"
              className="min-w-0 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </label>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
      </div>
      {author && (
        <p className="mt-2 text-xs text-slate-400">
          Author filter applies to notes and system events — sent messages have no author.
        </p>
      )}

      {authorOptions.isError && <p role="alert" className="mt-2 text-sm text-red-700">Could not load authors. <button type="button" className="underline" onClick={() => void authorOptions.refetch()}>Retry authors</button></p>}
      {pinned.isLoading && <p role="status" className="mt-4 text-sm text-slate-500">Loading pinned notes…</p>}
      {pinned.isError && <p role="alert" className="mt-4 text-sm text-red-700">Could not load pinned notes. <button type="button" className="underline" onClick={() => void pinned.refetch()}>Retry pinned notes</button></p>}
      {setPinned.isError && <p role="alert" className="mt-2 text-sm text-red-700">Could not update the pin. Please try again.</p>}
      {/* Pinned notes */}
      {showPinned && (
        <section aria-label="Pinned notes" className="mt-4 space-y-2">
          {pinnedEntries.map((entry) => (
            <PinnedNoteCard
              key={entry.id}
              entry={entry}
              expanded={expanded.has(`pin-${entry.id}`)}
              onToggle={() => toggleExpanded(`pin-${entry.id}`)}
              canUnpin={writable}
              unpinning={setPinned.isPending}
              onUnpin={() => handlePin(entry.id, false)}
            />
          ))}
          {pinned.hasNextPage && <Button variant="outline" size="sm" disabled={pinned.isFetchingNextPage} onClick={() => void pinned.fetchNextPage()}>Load older pinned notes</Button>}
        </section>
      )}

      {/* History body */}
      <div
        role="tabpanel"
        id={`history-panel-${tab}`}
        aria-labelledby={`history-tab-${tab}`}
        className="mt-4"
      >
        {history.isLoading && <HistorySkeleton />}

        {initialError && (
          <ErrorState
            title="Could not load history"
            message="The timeline failed to load. Your history is intact — try again."
            onRetry={() => history.refetch()}
          />
        )}

        {!history.isLoading && !initialError && entries.length === 0 && !filtersActive && (
          <EmptyState
            icon={<MailCheck className="h-6 w-6" />}
            title="No activity yet"
            description="Notes, messages, and system updates for this lead will appear here, newest first."
          />
        )}

        {!history.isLoading && !initialError && entries.length === 0 && filtersActive && (
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="No matches in history"
            description="Nothing in the full history matches these filters. Try widening the dates or clearing the search."
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        )}

        {!history.isLoading && !initialError && entries.length > 0 && (
          <div className="relative">
            <div className="absolute bottom-0 left-4 top-0 w-px bg-slate-200" aria-hidden="true" />
            <div className="space-y-5">
              {dateGroups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h4 className="mb-2 flex items-center gap-2 pl-10 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {group.label}
                  </h4>
                  <ul className="space-y-3 pl-10">
                    {group.nodes.map((node) =>
                      node.kind === 'entry' ? (
                        <HistoryEntryItem
                          key={node.entry.id}
                          entry={node.entry}
                          expanded={expanded.has(node.entry.id)}
                          onToggle={() => toggleExpanded(node.entry.id)}
                          canPin={writable && node.entry.source === 'activity'}
                          pinning={setPinned.isPending}
                          onPin={(pin) => handlePin(node.entry.id, pin)}
                        />
                      ) : (
                        <SystemGroupItem
                          key={node.key}
                          groupKey={node.key}
                          entries={node.entries}
                          expanded={expanded.has(node.key)}
                          onToggle={() => toggleExpanded(node.key)}
                        />
                      ),
                    )}
                  </ul>
                </section>
              ))}
            </div>

            <div className="mt-6 flex flex-col items-center gap-2 border-t border-slate-100 pt-4">
              {history.isFetchNextPageError && <p role="alert" className="text-sm text-red-700">Could not load older activity. Try again below.</p>}
              {history.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { olderScrollPosition.current = window.scrollY; void history.fetchNextPage(); }}
                  disabled={history.isFetchingNextPage}
                >
                  {history.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
                </Button>
              ) : (
                <p className="text-xs text-slate-400">You&apos;re caught up — no older activity.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry rows ───────────────────────────────────────────────────────────────

function HistoryEntryItem({
  entry,
  expanded,
  onToggle,
  canPin,
  pinning,
  onPin,
}: {
  entry: LeadHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  canPin: boolean;
  pinning: boolean;
  onPin: (pin: boolean) => void;
}) {
  const text = entryText(entry);
  const hasMore = text.length > PREVIEW_LENGTH;
  const isNote = entry.source === 'activity' && entry.activity_type === 'note';
  const statusStyle =
    entry.source === 'message' ? (STATUS_STYLES[entry.status ?? ''] ?? STATUS_STYLES.pending) : '';

  return (
    <li className="relative">
      <div
        className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 ring-2 ring-slate-200"
        aria-hidden="true"
      >
        <EntryIcon entry={entry} />
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-900">{entryTitle(entry)}</p>
          {entry.source === 'message' && entry.status && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle}`}>
              {entry.status}
            </span>
          )}
          {entry.is_pinned && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              <Pin className="h-3 w-3" />
              Pinned
            </span>
          )}
          <time
            dateTime={entry.created_at}
            title={timeAgo(entry.created_at)}
            className="ml-auto shrink-0 text-xs text-slate-400"
          >
            {readableTimestamp(entry.created_at)}
          </time>
        </div>

        {text && (
          <div className="mt-1">
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {expanded || !hasMore ? text : `${text.slice(0, PREVIEW_LENGTH)}…`}
            </p>
            {hasMore && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="mt-1 inline-flex items-center gap-1 rounded text-xs font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" /> Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {entry.source === 'message' && entry.error_message && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {entry.error_message}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {entry.author_name && <span>by {entry.author_name}</span>}
          {isNote && canPin && (
            <button
              type="button"
              onClick={() => onPin(!entry.is_pinned)}
              disabled={pinning}
              aria-label={entry.is_pinned ? 'Unpin note' : 'Pin note'}
              className="inline-flex items-center gap-1 rounded font-medium text-slate-500 hover:text-indigo-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {entry.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              {entry.is_pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function SystemGroupItem({
  groupKey,
  entries,
  expanded,
  onToggle,
}: {
  groupKey: string;
  entries: LeadHistoryEntry[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="relative">
      <div
        className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 ring-2 ring-slate-200"
        aria-hidden="true"
      >
        <Clock className="h-3.5 w-3.5" />
      </div>
      <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={`${groupKey}-details`}
          className="flex w-full flex-wrap items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
          <span className="text-sm font-medium text-slate-900">
            {entries.length} system updates
          </span>
          <time
            dateTime={entries[0].created_at}
            title={timeAgo(entries[0].created_at)}
            className="ml-auto shrink-0 text-xs text-slate-400"
          >
            {readableTimestamp(entries[0].created_at)}
          </time>
        </button>
        {expanded && (
          <ul id={`${groupKey}-details`} className="mt-2 space-y-2 border-t border-slate-200 pt-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{entryTitle(entry)}</p>
                  <p className="text-slate-600">{entryText(entry)}</p>
                  {entry.author_name && (
                    <p className="mt-0.5 text-xs text-slate-400">by {entry.author_name}</p>
                  )}
                </div>
                <time
                  dateTime={entry.created_at}
                  title={timeAgo(entry.created_at)}
                  className="shrink-0 text-xs text-slate-400"
                >
                  {readableTimestamp(entry.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function PinnedNoteCard({
  entry,
  expanded,
  onToggle,
  canUnpin,
  unpinning,
  onUnpin,
}: {
  entry: LeadHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
  canUnpin: boolean;
  unpinning: boolean;
  onUnpin: () => void;
}) {
  const text = entryText(entry);
  const hasMore = text.length > PREVIEW_LENGTH;
  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm font-semibold text-amber-900">Pinned note</p>
        <time
          dateTime={entry.created_at}
          title={timeAgo(entry.created_at)}
          className="ml-auto shrink-0 text-xs text-amber-700/70"
        >
          {readableTimestamp(entry.created_at)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">
        {expanded || !hasMore ? text : `${text.slice(0, PREVIEW_LENGTH)}…`}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
        {hasMore && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded font-medium text-amber-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show more
              </>
            )}
          </button>
        )}
        {entry.author_name && <span className="text-slate-500">by {entry.author_name}</span>}
        {canUnpin && (
          <button
            type="button"
            onClick={onUnpin}
            disabled={unpinning}
            aria-label="Unpin note"
            className="inline-flex items-center gap-1 rounded font-medium text-slate-500 hover:text-amber-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          >
            <PinOff className="h-3 w-3" />
            Unpin
          </button>
        )}
      </div>
    </article>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading history">
      {[0, 1, 2].map((n) => (
        <div key={n} className="flex gap-3">
          <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading history…</span>
    </div>
  );
}
