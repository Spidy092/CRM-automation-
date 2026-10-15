import { useState } from 'react';
import {
  useSubscribers,
  useSubscriberCounts,
  useSubscriber,
  useBroadcasts,
  useDigestStatus,
  useDigestDraft,
  useToggleAutomatedDigest,
  useRetryBroadcast,
  useUncertainRecipients,
  type NewsletterSubscriberStatus,
  type NewsletterFrequency,
  type NewsletterTopic,
} from '@/api/newsletter';
import { apiClient } from '@/api/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { TablePagination } from '@/components/ui/TablePagination';
import { InboxIcon, Info, Send, Sparkles, Settings, Copy, Download, Search } from 'lucide-react';
import { NewsletterBroadcastModal } from '@/components/ui/NewsletterBroadcastModal';
import { NewsletterDigestConfigModal } from '@/components/ui/NewsletterDigestConfigModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';

const statusTones: Record<NewsletterSubscriberStatus, StatusTone> = {
  confirmed: 'green',
  pending: 'amber',
  unsubscribed: 'gray',
};

const broadcastTones: Record<string, StatusTone> = {
  completed: 'green',
  partially_failed: 'amber',
  failed: 'red',
  processing: 'blue',
  draft: 'gray',
  scheduled: 'blue',
};

type Tab = 'overview' | 'subscribers' | 'broadcasts' | 'digest';

const TOPICS: NewsletterTopic[] = ['product_updates', 'promotions', 'company_news'];
const FREQUENCIES: NewsletterFrequency[] = ['daily', 'weekly', 'monthly'];

export function NewsletterPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [statusFilter, setStatusFilter] = useState<NewsletterSubscriberStatus | ''>('');
  const [topicFilter, setTopicFilter] = useState<NewsletterTopic | ''>('');
  const [frequencyFilter, setFrequencyFilter] = useState<NewsletterFrequency | ''>('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<string | null>(null);
  const [includeUncertain, setIncludeUncertain] = useState(false);
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [isDigestConfigModalOpen, setIsDigestConfigModalOpen] = useState(false);
  const { showToast } = useToast();
  const accessToken = useAuthStore((s) => s.accessToken);

  const countsQuery = useSubscriberCounts();
  const subsQuery = useSubscribers({
    limit: pageSize,
    offset: page * pageSize,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(search ? { search } : {}),
    ...(topicFilter ? { topic: topicFilter } : {}),
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(frequencyFilter ? { frequency: frequencyFilter } : {}),
  });
  const detailQuery = useSubscriber(selectedId ?? '');
  const broadcastsQuery = useBroadcasts();
  const digestStatusQuery = useDigestStatus();
  const digestDraftQuery = useDigestDraft();
  const toggleDigestMutation = useToggleAutomatedDigest();
  const retryMutation = useRetryBroadcast();
  const uncertainQuery = useUncertainRecipients(selectedBroadcastId);

  const subscribers = subsQuery.data?.data ?? [];
  const total = (subsQuery.data?.meta?.total as number | undefined) ?? subscribers.length;
  const counts = countsQuery.data;

  const handleToggleDigest = async () => {
    const newState = !(digestStatusQuery.data?.enabled ?? false);
    try {
      await toggleDigestMutation.mutateAsync({ enabled: newState });
      showToast(`Automated digest ${newState ? 'enabled' : 'disabled'}.`);
    } catch {
      showToast('Failed to toggle automated digest.', 'error');
    }
  };

  const handleCopySignupLink = async () => {
    const link = `${window.location.origin}/subscribe`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Signup link copied.');
    } catch {
      showToast('Could not copy link.', 'error');
    }
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (search) params.append('search', search);
      if (topicFilter) params.append('topic', topicFilter);
      if (sourceFilter) params.append('source', sourceFilter);
      if (frequencyFilter) params.append('frequency', frequencyFilter);
      const qs = params.toString();
      const response = await apiClient.get(`/newsletter/admin/subscribers/export${qs ? `?${qs}` : ''}`, {
        responseType: 'blob',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'newsletter-subscribers.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Export failed.', 'error');
    }
  };

  const resetFilters = () => {
    setStatusFilter('');
    setTopicFilter('');
    setFrequencyFilter('');
    setSourceFilter('');
    setSearch('');
    setSearchInput('');
    setPage(0);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'subscribers', label: 'Subscribers' },
    { id: 'broadcasts', label: 'Broadcasts' },
    { id: 'digest', label: 'AI Digest' },
  ];

  const selectedBroadcast = broadcastsQuery.data?.find((b) => b.id === selectedBroadcastId) ?? null;

  const handleRetry = async () => {
    if (!selectedBroadcast) return;
    try {
      const res = await retryMutation.mutateAsync({
        id: selectedBroadcast.id,
        includeUncertain: includeUncertain && (selectedBroadcast.uncertain ?? 0) > 0,
      });
      showToast(
        `Retry enqueued for ${res.retrying ?? 0} failed${(res.retryingUncertain ?? 0) > 0 ? ` + ${res.retryingUncertain} uncertain` : ''} recipient(s).`,
      );
      setIncludeUncertain(false);
    } catch {
      showToast('Failed to enqueue retry.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Automation"
        title="Newsletters"
        description="Compose, target, and review newsletter sends. Automated digests are drafts for human review unless auto-send is explicitly on."
        metrics={[
          { label: 'Total', value: counts?.total ?? '—' },
          { label: 'Confirmed', value: counts?.confirmed ?? '—', tone: 'success' },
          { label: 'Pending', value: counts?.pending ?? '—', tone: 'warning' },
          { label: 'Unsubscribed', value: counts?.unsubscribed ?? '—', tone: 'default' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2" onClick={() => setIsDigestConfigModalOpen(true)}>
              <Settings className="h-4 w-4" />
              Configure AI Digest
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleToggleDigest}
              disabled={toggleDigestMutation.isPending || digestStatusQuery.isLoading}
            >
              <Sparkles className="h-4 w-4" />
              {digestStatusQuery.data?.enabled ? 'AI Digest Enabled' : 'Enable AI Digest'}
            </Button>
            <Button className="gap-2" onClick={() => setIsBroadcastModalOpen(true)}>
              <Send className="h-4 w-4" />
              Create newsletter
            </Button>
          </div>
        }
      />

      {isDigestConfigModalOpen && (
        <NewsletterDigestConfigModal onClose={() => setIsDigestConfigModalOpen(false)} />
      )}
      {isBroadcastModalOpen && (
        <NewsletterBroadcastModal onClose={() => setIsBroadcastModalOpen(false)} />
      )}

      <div role="tablist" aria-label="Newsletter workspace" className="flex gap-1 rounded-lg border bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const idx = tabs.findIndex((x) => x.id === tab);
              const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
              setTab(tabs[next].id);
              document.getElementById(`tab-${tabs[next].id}`)?.focus();
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><h3 className="font-semibold">Audience</h3></CardHeader>
            <CardContent>
              {countsQuery.isLoading && <LoadingSpinner />}
              {countsQuery.error && <ErrorState message={(countsQuery.error as Error).message} onRetry={() => countsQuery.refetch()} />}
              {counts && (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3"><dt className="text-slate-500">Total</dt><dd className="text-xl font-bold">{counts.total}</dd></div>
                  <div className="rounded-lg bg-green-50 p-3"><dt className="text-slate-500">Confirmed</dt><dd className="text-xl font-bold">{counts.confirmed}</dd></div>
                  <div className="rounded-lg bg-amber-50 p-3"><dt className="text-slate-500">Pending</dt><dd className="text-xl font-bold">{counts.pending}</dd></div>
                  <div className="rounded-lg bg-slate-100 p-3"><dt className="text-slate-500">Unsubscribed</dt><dd className="text-xl font-bold">{counts.unsubscribed}</dd></div>
                </dl>
              )}
              <p className="mt-3 text-xs text-slate-500">Counts are audience-wide, independent of list filters/page.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h3 className="font-semibold">AI Digest</h3></CardHeader>
            <CardContent>
              {digestStatusQuery.isLoading && <LoadingSpinner />}
              {digestStatusQuery.error && <ErrorState message={(digestStatusQuery.error as Error).message} onRetry={() => digestStatusQuery.refetch()} />}
              {digestStatusQuery.data && (
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Enabled</dt><dd className="font-medium">{digestStatusQuery.data.enabled ? 'On' : 'Off'}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Schedule</dt><dd>{digestStatusQuery.data.schedule} · {digestStatusQuery.data.timezone}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Next run</dt><dd>{digestStatusQuery.data.enabled ? (digestStatusQuery.data.nextRunAt ? new Date(digestStatusQuery.data.nextRunAt).toLocaleString() : 'Not reported by scheduler') : '—'}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-slate-500">Last outcome</dt><dd className="text-right">{digestStatusQuery.data.lastOutcome.status.replace('_', ' ')} — {digestStatusQuery.data.lastOutcome.message}</dd></div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'subscribers' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="subs-search">Search by email</label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="subs-search"
                    placeholder="Search email…"
                    className="pl-8"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(0); } }}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => { setSearch(searchInput); setPage(0); }}>Search</Button>
                <label className="sr-only" htmlFor="subscribers-status-filter">Filter by status</label>
                <select
                  id="subscribers-status-filter"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as NewsletterSubscriberStatus | ''); setPage(0); }}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">All Statuses</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="unsubscribed">Unsubscribed</option>
                </select>
                <label className="sr-only" htmlFor="subs-topic">Filter by topic</label>
                <select id="subs-topic" value={topicFilter} onChange={(e) => { setTopicFilter(e.target.value as NewsletterTopic | ''); setPage(0); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">All Topics</option>
                  {TOPICS.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
                <label className="sr-only" htmlFor="subs-frequency">Filter by frequency</label>
                <select id="subs-frequency" value={frequencyFilter} onChange={(e) => { setFrequencyFilter(e.target.value as NewsletterFrequency | ''); setPage(0); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">All Frequencies</option>
                  {FREQUENCIES.map((f) => (<option key={f} value={f}>{f}</option>))}
                </select>
                <label className="sr-only" htmlFor="subs-source">Filter by source</label>
                <Input id="subs-source" placeholder="Source…" className="w-32" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }} />
                <Button variant="ghost" size="sm" onClick={resetFilters}>Clear</Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={handleCopySignupLink}>
                  <Copy className="h-3.5 w-3.5" /> Copy signup link
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={handleExport}>
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <details className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <summary className="flex cursor-pointer items-center gap-2 font-medium text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                <Info className="h-4 w-4" /> How Newsletter Subscriptions Work
              </summary>
              <div className="mt-2 space-y-2 text-sm text-blue-800">
                <p><strong>1. Public Form:</strong> Direct users to your public subscription page: <span className="font-medium">/subscribe</span> (use “Copy signup link”).</p>
                <p><strong>2. Confirmation Email:</strong> New signups are <span className="font-medium">pending</span> until they confirm via the emailed link. Imports never silently subscribe — every address confirms first.</p>
                <p><strong>3. Preferences & Unsubscribe:</strong> Every broadcast footer carries per-recipient preference/unsubscribe links. Pending, unsubscribed, and suppressed recipients are excluded and rechecked before dispatch.</p>
              </div>
            </details>

            {subsQuery.isLoading && <LoadingTable />}
            {!subsQuery.isLoading && subsQuery.error && (
              <ErrorState message={(subsQuery.error as Error).message} onRetry={() => subsQuery.refetch()} />
            )}
            {!subsQuery.isLoading && !subsQuery.error && subscribers.length === 0 && (
              <EmptyState
                icon={<InboxIcon className="h-6 w-6" />}
                title="No subscribers found"
                description="No newsletter subscribers match the current filters."
              />
            )}
            {!subsQuery.isLoading && !subsQuery.error && subscribers.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="pb-3 pr-3 text-left font-medium text-slate-500">Email</th>
                        <th className="pb-3 text-left font-medium text-slate-500">Status</th>
                        <th className="pb-3 text-left font-medium text-slate-500">Frequency</th>
                        <th className="pb-3 text-left font-medium text-slate-500">Topics</th>
                        <th className="pb-3 text-left font-medium text-slate-500">Source</th>
                        <th className="pb-3 text-left font-medium text-slate-500">Date Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers.map((subscriber) => (
                        <tr key={subscriber.id} className="border-b transition-colors hover:bg-slate-50">
                          <td className="py-3 pr-3">
                            <button type="button" onClick={() => setSelectedId(subscriber.id)} className="font-medium text-slate-900 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" aria-label={`View details for ${subscriber.email}`}>
                              {subscriber.email}
                            </button>
                          </td>
                          <td className="py-3"><StatusBadge tone={statusTones[subscriber.status]}>{subscriber.status}</StatusBadge></td>
                          <td className="py-3 text-slate-700 capitalize">{subscriber.frequency}</td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {subscriber.topics?.length ? subscriber.topics.map((topic) => (
                                <span key={topic} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">{topic}</span>
                              )) : <span className="text-xs text-slate-400">—</span>}
                            </div>
                          </td>
                          <td className="py-3 text-slate-500">{subscriber.source || '—'}</td>
                          <td className="py-3 text-slate-500">{new Date(subscriber.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  rowCount={subscribers.length}
                  total={total}
                  hasMore={(page + 1) * pageSize < total}
                  isLoading={subsQuery.isLoading}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
                />
              </>
            )}

            {selectedId && (
              <div className="mt-4 rounded-lg border p-4" role="dialog" aria-label="Subscriber details">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Subscriber details</h4>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
                </div>
                {detailQuery.isLoading && <LoadingSpinner />}
                {detailQuery.error && <ErrorState message={(detailQuery.error as Error).message} onRetry={() => detailQuery.refetch()} />}
                {detailQuery.data && (
                  <dl className="mt-2 grid gap-1 text-sm">
                    <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd className="font-medium">{detailQuery.data.email}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd>{detailQuery.data.status}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Topics</dt><dd>{detailQuery.data.topics.join(', ') || '—'}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Frequency</dt><dd>{detailQuery.data.frequency}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Confirmed at</dt><dd>{detailQuery.data.confirmed_at ? new Date(detailQuery.data.confirmed_at).toLocaleString() : '—'}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Unsubscribed at</dt><dd>{detailQuery.data.unsubscribed_at ? new Date(detailQuery.data.unsubscribed_at).toLocaleString() : '—'}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500">Created</dt><dd>{new Date(detailQuery.data.created_at).toLocaleString()}</dd></div>
                  </dl>
                )}
                <p className="mt-2 text-xs text-slate-500">Consent history: only persisted lifecycle timestamps above are shown. Full consent trails are unavailable — timestamps are never fabricated or inferred from CRM lead membership.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'broadcasts' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Broadcast history</h3>
              <Button size="sm" className="gap-2" onClick={() => setIsBroadcastModalOpen(true)}><Send className="h-3.5 w-3.5" /> Create newsletter</Button>
            </div>
          </CardHeader>
          <CardContent>
            {digestDraftQuery.data?.draft?.status === 'draft' && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <StatusBadge tone="amber">draft</StatusBadge>
                <span className="ml-2 font-medium">{digestDraftQuery.data.draft.subject}</span>
                <span className="ml-2 text-slate-500">AI draft awaiting review — open “Configure AI Digest” to preview, edit, and approve.</span>
              </div>
            )}
            {broadcastsQuery.isLoading && <LoadingTable />}
            {broadcastsQuery.error && <ErrorState message={(broadcastsQuery.error as Error).message} onRetry={() => broadcastsQuery.refetch()} />}
            {!broadcastsQuery.isLoading && !broadcastsQuery.error && (broadcastsQuery.data ?? []).length === 0 && digestDraftQuery.data?.draft?.status !== 'draft' && (
              <EmptyState icon={<InboxIcon className="h-6 w-6" />} title="No broadcasts yet" description="Create your first newsletter to see history here." />
            )}
            {!broadcastsQuery.isLoading && !broadcastsQuery.error && (broadcastsQuery.data ?? []).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-3 pr-3 text-left font-medium text-slate-500">Subject</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Status</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Attempted</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Accepted</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Failed</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Uncertain</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Timezone</th>
                      <th className="pb-3 text-left font-medium text-slate-500">Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {broadcastsQuery.data!.map((b) => (
                      <tr key={b.id} className="border-b hover:bg-slate-50">
                        <td className="py-3 pr-3">
                          <button type="button" onClick={() => setSelectedBroadcastId(b.id)} className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900" aria-label={`View broadcast ${b.subject}`}>
                            {b.subject}
                          </button>
                        </td>
                        <td className="py-3"><StatusBadge tone={broadcastTones[b.status] ?? 'gray'}>{b.status.replace('_', ' ')}</StatusBadge></td>
                        <td className="py-3">{b.attempted}</td>
                        <td className="py-3">{b.accepted}</td>
                        <td className="py-3">{b.failed}</td>
                        <td className="py-3">{b.uncertain ?? 0}</td>
                        <td className="py-3 text-slate-500">{b.timezone}</td>
                        <td className="py-3 text-slate-500">{new Date(b.finishedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedBroadcast && (
              <div className="mt-4 rounded-lg border p-4 text-sm" role="dialog" aria-label={`Broadcast detail: ${selectedBroadcast.subject}`}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{selectedBroadcast.subject}</h4>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedBroadcastId(null)}>Close</Button>
                </div>
                <dl className="mt-2 grid gap-1">
                  <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd>{selectedBroadcast.status.replace('_', ' ')}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Audience</dt><dd>{selectedBroadcast.topics.length ? selectedBroadcast.topics.join(', ') : 'All confirmed'} · {selectedBroadcast.frequencies?.length ? selectedBroadcast.frequencies.join(' + ') : (selectedBroadcast.frequency ?? 'any frequency')}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Creator</dt><dd>{selectedBroadcast.createdBy ?? (selectedBroadcast.source === 'redis' ? 'Not recorded (pre-persistence history)' : 'System')}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Finished</dt><dd>{new Date(selectedBroadcast.finishedAt).toLocaleString()} ({selectedBroadcast.timezone})</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Accepted / Failed</dt><dd>{selectedBroadcast.accepted} / {selectedBroadcast.failed} (attempted {selectedBroadcast.attempted}, skipped {selectedBroadcast.skipped})</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Uncertain sends</dt><dd>{selectedBroadcast.uncertain ?? 0} — outcome unknown, never auto-resent</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Delivered / Bounced / Clicked / Unsubscribed</dt><dd>Unavailable — no provider event feed for newsletters</dd></div>
                </dl>
                {selectedBroadcast.failed > 0 && (
                  <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800" role="alert">
                    {selectedBroadcast.failed} recipient(s) were not accepted by any provider. Failures are per-recipient and actionable in the worker outcome record; partial sends are never retried wholesale to avoid duplicates. Check provider credentials (SendGrid/SMTP) and re-send only to the failed segment.
                  </p>
                )}
                {(selectedBroadcast.uncertain ?? 0) > 0 && selectedBroadcast.failed === 0 && (
                  <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800" role="alert">
                    {selectedBroadcast.uncertain} recipient(s) have an unknown send outcome — this broadcast is marked partially failed, not completed, until an operator reviews and resolves them below.
                  </p>
                )}
                {(selectedBroadcast.uncertain ?? 0) > 0 && (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="alert">
                    <p className="font-medium">{selectedBroadcast.uncertain} recipient(s) have an UNKNOWN send outcome (interrupted send — a retry must not assume delivery or assume failure).</p>
                    {uncertainQuery.isLoading && <p className="mt-1">Loading uncertain recipients…</p>}
                    {uncertainQuery.data && uncertainQuery.data.length > 0 && (
                      <ul className="mt-1 list-disc pl-5">
                        {uncertainQuery.data.slice(0, 20).map((u) => (
                          <li key={u.subscriberId}>{u.email ?? u.subscriberId}</li>
                        ))}
                      </ul>
                    )}
                    <label className="mt-2 flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={includeUncertain}
                        onChange={(e) => setIncludeUncertain(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>Include uncertain recipients in the retry — I accept these may already have been sent (possible duplicates).</span>
                    </label>
                  </div>
                )}
                {(selectedBroadcast.failed > 0 || (selectedBroadcast.uncertain ?? 0) > 0) && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retryMutation.isPending}
                      onClick={handleRetry}
                    >
                      {retryMutation.isPending ? 'Enqueueing retry…' : `Retry failed${includeUncertain && (selectedBroadcast.uncertain ?? 0) > 0 ? ' + uncertain' : ''} recipients`}
                    </Button>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">“Accepted” means a provider acknowledged receipt — not delivery. Delivery requires provider webhooks, which newsletters do not yet ingest (outreach email does via SendGrid events).</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'digest' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">AI Digest</h3>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsDigestConfigModalOpen(true)}><Settings className="h-3.5 w-3.5" /> Configure</Button>
            </div>
          </CardHeader>
          <CardContent>
            {digestStatusQuery.isLoading && <LoadingSpinner />}
            {digestStatusQuery.error && <ErrorState message={(digestStatusQuery.error as Error).message} onRetry={() => digestStatusQuery.refetch()} />}
            {digestStatusQuery.data && (
              <dl className="grid gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Enabled</dt><dd className="font-medium">{digestStatusQuery.data.enabled ? 'On' : 'Off'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Schedule</dt><dd>{digestStatusQuery.data.schedule} · {digestStatusQuery.data.timezone}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Next run</dt><dd>{digestStatusQuery.data.enabled ? (digestStatusQuery.data.nextRunAt ? new Date(digestStatusQuery.data.nextRunAt).toLocaleString() : 'Not reported by scheduler') : '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Last outcome</dt><dd className="text-right">{digestStatusQuery.data.lastOutcome.status.replace('_', ' ')} — {digestStatusQuery.data.lastOutcome.message}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Auto-send</dt><dd>{digestStatusQuery.data.autoSend ? 'On (sends to daily + weekly confirmed)' : 'Off (drafts for review — default)'}</dd></div>
              </dl>
            )}
            <p className="mt-3 text-xs text-slate-500">AI failures are shown in “Last outcome” and never send silently-degraded content. Prompts carry only topic/tone/audience (no subscriber PII); completions are capped at 500 tokens.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
