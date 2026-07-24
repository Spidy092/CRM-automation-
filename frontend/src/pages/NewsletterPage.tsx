import { useState } from 'react';
import { useSubscribers } from '@/api/newsletter';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { InboxIcon, Link as LinkIcon, Info, Send, Sparkles, Settings } from 'lucide-react';
import type { NewsletterSubscriberStatus } from '@/api/newsletter';
import { NewsletterBroadcastModal } from '@/components/ui/NewsletterBroadcastModal';
import { NewsletterDigestConfigModal } from '@/components/ui/NewsletterDigestConfigModal';
import { Button } from '@/components/ui/button';
import { useToggleAutomatedDigest } from '@/api/newsletter';
import { useToast } from '@/components/ui/Toast';

const statusTones: Record<NewsletterSubscriberStatus, StatusTone> = {
  confirmed: 'green',
  pending: 'amber',
  unsubscribed: 'gray',
};

export function NewsletterPage() {
  const [statusFilter, setStatusFilter] = useState<NewsletterSubscriberStatus | ''>('');
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [isDigestConfigModalOpen, setIsDigestConfigModalOpen] = useState(false);
  const [isAutomatedDigestEnabled, setIsAutomatedDigestEnabled] = useState(false);
  
  const toggleDigestMutation = useToggleAutomatedDigest();
  const { showToast } = useToast();

  const handleToggleDigest = async () => {
    const newState = !isAutomatedDigestEnabled;
    try {
      await toggleDigestMutation.mutateAsync({ enabled: newState });
      setIsAutomatedDigestEnabled(newState);
      showToast(`Automated digest ${newState ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      showToast('Failed to toggle automated digest.', 'error');
    }
  };
  
  const { data, isLoading, error } = useSubscribers({
    limit: 100,
    status: statusFilter || undefined,
  });

  const subscribers = data?.data ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Automation"
        title="Newsletter Subscribers"
        description="Manage your newsletter audience, view subscriber statuses, and preferences."
        metrics={[
          { label: 'Total Visible', value: subscribers.length },
          { label: 'Confirmed', value: subscribers.filter((s) => s.status === 'confirmed').length, tone: 'success' },
          { label: 'Pending', value: subscribers.filter((s) => s.status === 'pending').length, tone: 'warning' },
          { label: 'Unsubscribed', value: subscribers.filter((s) => s.status === 'unsubscribed').length, tone: 'default' },
        ]}
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setIsDigestConfigModalOpen(true)}
            >
              <Settings className="h-4 w-4" />
              Configure AI Digest
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleToggleDigest}
              disabled={toggleDigestMutation.isPending}
            >
              <Sparkles className="h-4 w-4" />
              {isAutomatedDigestEnabled ? 'AI Digest Enabled' : 'Enable AI Digest'}
            </Button>
            <Button className="gap-2" onClick={() => setIsBroadcastModalOpen(true)}>
              <Send className="h-4 w-4" />
              Send Broadcast
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

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              id="subscribers-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as NewsletterSubscriberStatus | '')}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[200px]"
            >
              <option value="">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 text-blue-600 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-blue-900">How Newsletter Subscriptions Work</h3>
                <div className="mt-2 text-sm text-blue-800 space-y-2">
                  <p>
                    <strong>1. Public Form:</strong> Direct users to your public subscription page: 
                    <a href="/subscribe" target="_blank" className="ml-1 inline-flex items-center font-medium hover:underline">
                      /subscribe <LinkIcon className="ml-1 h-3 w-3" />
                    </a>
                  </p>
                  <p>
                    <strong>2. Confirmation Email:</strong> Once subscribed, users receive a confirmation email with a unique magic link to verify their address. Their status will show as <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">pending</span> until confirmed.
                  </p>
                  <p>
                    <strong>3. Preferences & Unsubscribe:</strong> Marketing emails sent via Outreach contain an embedded preference link for each user to manage their frequency or opt-out securely.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {isLoading && <LoadingTable />}

          {!isLoading && error && (
            <ErrorState message={error.message} onRetry={() => window.location.reload()} />
          )}

          {!isLoading && !error && subscribers.length === 0 && (
            <EmptyState
              icon={<InboxIcon className="h-6 w-6" />}
              title="No subscribers found"
              description="You have no newsletter subscribers matching the current filter."
            />
          )}

          {!isLoading && !error && subscribers.length > 0 && (
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
                      <td className="py-3 pr-3 font-medium text-slate-900">
                        {subscriber.email}
                      </td>
                      <td className="py-3">
                        <StatusBadge tone={statusTones[subscriber.status]}>
                          {subscriber.status}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-slate-700 capitalize">
                        {subscriber.frequency}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {subscriber.topics?.length ? (
                            subscriber.topics.map((topic) => (
                              <span key={topic} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                {topic}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-slate-500">
                        {subscriber.source || '—'}
                      </td>
                      <td className="py-3 text-slate-500">
                        {new Date(subscriber.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
