import { useState } from 'react';
import { useDecisionLog, type DecisionType } from '@/api/aiDecisions';
import { PageHeader } from '@/components/ui/PageHeader';
import { AdminToolsTabs } from '@/components/AdminToolsTabs';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 25;

const decisionTypes: { value: DecisionType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'research', label: 'Research' },
  { value: 'next_action', label: 'Next action' },
  { value: 'reply_classify', label: 'Reply classify' },
  { value: 'campaign_brief', label: 'Campaign brief' },
];

const typeTones: Record<DecisionType, StatusTone> = {
  research: 'blue',
  next_action: 'violet',
  reply_classify: 'cyan',
  campaign_brief: 'amber',
};

export function AIDecisionLogPage() {
  const [filter, setFilter] = useState<DecisionType | 'all'>('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useDecisionLog({
    decision_type: filter === 'all' ? undefined : filter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Admin · AI audit"
        title="AI Decision Log"
        description="Full chain-of-thought audit trail of every AI reasoning step."
        metrics={[{ label: 'Total decisions', value: total }]}
      />

      <AdminToolsTabs />

      <div className="flex flex-wrap gap-2">
        {decisionTypes.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={filter === t.value ? 'default' : 'outline'}
            onClick={() => {
              setFilter(t.value);
              setPage(0);
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading && <LoadingSpinner />}

      {error && !isLoading && (
        <ErrorState message="Could not load the decision log" />
      )}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          icon={<Brain className="h-6 w-6" />}
          title="No decisions logged"
          description="AI reasoning steps will appear here as the system researches leads and classifies replies."
        />
      )}

      {!isLoading && !error && items.length > 0 && (
        <>
          <div className="space-y-2">
            {items.map((d) => {
              const isOpen = expanded.has(d.id);
              return (
                <Card key={d.id}>
                  <CardContent className="p-4">
                    <button
                      onClick={() => toggle(d.id)}
                      className="flex w-full items-start justify-between gap-4 text-left"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={typeTones[d.decision_type]}>
                            {d.decision_type.replace('_', ' ')}
                          </StatusBadge>
                          <span className="text-sm font-medium text-slate-900">{d.decision}</span>
                          {d.confidence !== null && (
                            <StatusBadge tone="gray">Confidence {d.confidence}</StatusBadge>
                          )}
                          {d.autonomy_level && (
                            <StatusBadge tone="violet">{d.autonomy_level}</StatusBadge>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {d.model_used ?? 'model n/a'} · {d.tokens_used ?? 0} tokens · {d.latency_ms ?? 0}ms ·{' '}
                          {new Date(d.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="shrink-0 text-slate-400">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Chain of thought
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                            {d.chain_of_thought ?? '— no reasoning recorded —'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Input context
                          </p>
                          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                            {JSON.stringify(d.input_context, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AIDecisionLogPage;
