import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useInbox,
  useActionInboxItem,
  type AiInboxItem,
  type AiInboxItemType,
} from '@/api/aiInbox';
import { useApprovePlan } from '@/api/agentPlans';
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

interface InboxItemCardProps {
  item: AiInboxItem;
  pendingId: string | null;
  onAction: (item: AiInboxItem, action: 'approve' | 'reject' | 'snooze') => void;
  hideApprove?: boolean;
}

function InboxItemCard({ item, pendingId, onAction, hideApprove }: InboxItemCardProps) {
  return (
    <Card>
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
          {item.action_result && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-600">Action result</p>
              {/* Structured result display — shows status, key fields, avoids leaking internal structures */}
              {typeof item.action_result === 'object' && item.action_result !== null ? (
                <div className="mt-1 space-y-1 text-sm text-emerald-800">
                  {(item.action_result as Record<string, unknown>).status !== undefined && (
                    <p>
                      <span className="font-medium">Status:</span>{' '}
                      {String((item.action_result as Record<string, unknown>).status)}
                    </p>
                  )}
                  {(item.action_result as Record<string, unknown>).message !== undefined && (
                    <p>
                      <span className="font-medium">Result:</span>{' '}
                      {String((item.action_result as Record<string, unknown>).message)}
                    </p>
                  )}
                  {(item.action_result as Record<string, unknown>).status === undefined &&
                    (item.action_result as Record<string, unknown>).message === undefined && (
                      <p className="text-xs italic text-emerald-600">Action completed</p>
                    )}
                </div>
              ) : (
                <p className="mt-1 break-words text-sm text-emerald-800">
                  {String(item.action_result)}
                </p>
              )}
            </div>
          )}
          {item.agent_action_id && <StatusBadge tone="gray">Agent action linked</StatusBadge>}
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
          {!hideApprove && (
            <Button
              size="sm"
              onClick={() => onAction(item, 'approve')}
              disabled={pendingId === item.id}
            >
              <Check className="mr-1 h-4 w-4" /> Approve
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(item, 'snooze')}
            disabled={pendingId === item.id}
          >
            <Clock className="mr-1 h-4 w-4" /> Snooze
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(item, 'reject')}
            disabled={pendingId === item.id}
            className="text-red-600 hover:text-red-700"
          >
            <X className="mr-1 h-4 w-4" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AIInboxPage() {
  const { showToast } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPendingPlanId, setBulkPendingPlanId] = useState<string | null>(null);
  const { data, isLoading, error } = useInbox({ status: 'pending' });
  const actionItem = useActionInboxItem();
  const approvePlan = useApprovePlan();

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

  const handleApprovePlan = async (planId: string) => {
    setBulkPendingPlanId(planId);
    try {
      await approvePlan.mutateAsync(planId);
      showToast('Plan approved and running.', 'success');
    } catch {
      showToast('Failed to approve plan.', 'error');
    } finally {
      setBulkPendingPlanId(null);
    }
  };

  const items = [...(data?.items ?? [])].sort((a, b) => b.urgency_score - a.urgency_score);

  const ungrouped = items.filter((i) => !i.agent_plan_id);
  const grouped = Object.values(
    items
      .filter((i): i is typeof i & { agent_plan_id: string } => Boolean(i.agent_plan_id))
      .reduce(
        (acc, item) => {
          if (!acc[item.agent_plan_id]) acc[item.agent_plan_id] = [];
          acc[item.agent_plan_id].push(item);
          return acc;
        },
        {} as Record<string, AiInboxItem[]>,
      ),
  );
  grouped.forEach((group) =>
    group.sort((a, b) => (a.agent_plan_step_id ?? '').localeCompare(b.agent_plan_step_id ?? '')),
  );

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
          {grouped.map((group) => {
            const planId = group[0].agent_plan_id;
            return (
              <Card key={planId} className="border-slate-200">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        Plan {planId.slice(0, 8)} · {group.length} step
                        {group.length === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-slate-500">Approve to run all steps below</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleApprovePlan(planId)}
                      disabled={bulkPendingPlanId === planId}
                    >
                      <Check className="mr-1 h-4 w-4" /> Approve all {group.length}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {group.map((item) => (
                      <InboxItemCard
                        key={item.id}
                        item={item}
                        pendingId={pendingId}
                        onAction={handleAction}
                        hideApprove
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {ungrouped.map((item) => (
            <InboxItemCard key={item.id} item={item} pendingId={pendingId} onAction={handleAction} />
          ))}
        </div>
      )}
    </div>
  );
}

export default AIInboxPage;
