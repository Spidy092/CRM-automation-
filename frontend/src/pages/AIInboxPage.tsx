import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useInbox,
  useActionInboxItem,
  type AiInboxItem,
  type AiInboxItemType,
} from '@/api/aiInbox';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { Inbox, Check, X, Clock, AlertCircle, ExternalLink } from 'lucide-react';

const typeLabels: Record<AiInboxItemType, string> = {
  approve_response: 'Approve response',
  urgent_reply: 'Urgent reply',
  pricing_inquiry: 'Pricing inquiry',
  campaign_review: 'Campaign review',
  lead_handoff: 'Lead handoff',
  objection_review: 'Objection review',
};

const typeTones: Record<AiInboxItemType, StatusTone> = {
  approve_response: 'blue',
  urgent_reply: 'red',
  pricing_inquiry: 'amber',
  campaign_review: 'violet',
  lead_handoff: 'green',
  objection_review: 'cyan',
};

function urgencyTone(score: number): StatusTone {
  if (score >= 75) return 'red';
  if (score >= 50) return 'amber';
  return 'gray';
}

export function AIInboxPage() {
  const { showToast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data, isLoading, error } = useInbox({ status: 'pending' });
  const actionItem = useActionInboxItem();

  const handleAction = async (item: AiInboxItem, action: 'approve' | 'reject' | 'snooze') => {
    setPendingId(item.id);
    try {
      const snoozed_until =
        action === 'snooze' ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : undefined;
      await actionItem.mutateAsync({ id: item.id, action, snoozed_until });
      showToast(
        action === 'approve' ? 'Item approved.' : action === 'reject' ? 'Item rejected.' : 'Item snoozed for 4h.',
        'success',
      );
    } catch {
      showToast('Failed to update inbox item.', 'error');
    } finally {
      setPendingId(null);
    }
  };

  const items = [...(data?.items ?? [])].sort((a, b) => b.urgency_score - a.urgency_score);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="AI Sales Copilot"
        title="AI Inbox"
        description="Priority task feed — the AI surfaces what needs your attention and why, sorted by urgency."
        metrics={[
          { label: 'Pending items', value: data?.total ?? 0 },
          {
            label: 'High urgency',
            value: items.filter((i) => i.urgency_score >= 75).length,
            tone: 'danger',
          },
        ]}
      />

      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
        </div>
      )}

      {error && !isLoading && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-red-400" />
          <p className="font-semibold text-red-700">Could not load your inbox</p>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={<Inbox className="h-6 w-6" />}
          title="Inbox zero"
          description="No items need your attention right now. New AI-flagged tasks will appear here."
        />
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={typeTones[item.item_type]}>{typeLabels[item.item_type]}</StatusBadge>
                    <StatusBadge tone={urgencyTone(item.urgency_score)}>
                      Urgency {item.urgency_score}
                    </StatusBadge>
                    {item.ai_draft_confidence !== null && (
                      <StatusBadge tone="gray">Confidence {item.ai_draft_confidence}</StatusBadge>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  {item.summary && <p className="text-sm text-slate-600">{item.summary}</p>}
                  {item.ai_draft_response && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">AI draft</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.ai_draft_response}</p>
                    </div>
                  )}
                  {item.lead_id && (
                    <Link
                      to={`/leads/${item.lead_id}/ai`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      View lead AI profile <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleAction(item, 'approve')}
                    disabled={pendingId === item.id}
                  >
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(item, 'snooze')}
                    disabled={pendingId === item.id}
                  >
                    <Clock className="mr-1 h-4 w-4" /> Snooze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(item, 'reject')}
                    disabled={pendingId === item.id}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default AIInboxPage;
