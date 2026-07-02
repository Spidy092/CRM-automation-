import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import type { PlanPreview as PlanPreviewType } from '@/api/agentPlans';

interface Props {
  preview: PlanPreviewType;
  onApprove: () => Promise<unknown> | void;
  onCancel: () => Promise<unknown> | void;
}

const RISK_TONE: Record<string, StatusTone> = {
  read: 'gray',
  low_risk_write: 'blue',
  sensitive_write: 'amber',
  customer_facing_write: 'red',
};

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'running':
      return 'blue';
    case 'paused_for_approval':
      return 'amber';
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'proposed':
    case 'pending':
    case 'cancelled':
    case 'skipped':
    default:
      return 'gray';
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function PlanPreview({ preview, onApprove, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };
  const handleCancel = async () => {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  };

  const isRunning = preview.plan.status === 'running';
  const isPaused = preview.plan.status === 'paused_for_approval';

  return (
    <Card className="my-2 border-slate-200">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-slate-900">Plan</h4>
              <StatusBadge tone={statusTone(preview.plan.status)}>
                {preview.plan.status}
              </StatusBadge>
              {preview.requiresApproval && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  <AlertTriangle size={12} />
                  Requires approval
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-700">{preview.plan.goal}</p>
            <p className="mt-1 text-xs text-slate-500">
              {preview.steps.length} steps · est. {formatCents(preview.estimatedCostCents)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-slate-500 hover:text-slate-700"
            aria-label={expanded ? 'Collapse plan' : 'Expand plan'}
          >
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        {expanded && (
          <ol className="mt-3 space-y-2 border-t pt-3">
            {preview.steps.map((step) => {
              const tone = RISK_TONE[step.risk_tier] ?? 'gray';
              return (
                <li key={step.id} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={16} className="mt-0.5 text-slate-400" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{step.action_name}</span>
                      <StatusBadge tone={statusTone(step.status)}>{step.status}</StatusBadge>
                      <span
                        className={`text-xs rounded px-1.5 py-0.5 bg-${tone}-100 text-${tone}-800`}
                      >
                        {step.risk_tier}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{step.rationale}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {(isPaused || preview.requiresApproval) && !isRunning && (
          <div className="mt-3 flex gap-2">
            <Button
              onClick={handleApprove}
              disabled={approving}
              size="sm"
              data-testid="approve-plan-btn"
            >
              {approving ? 'Approving...' : 'Approve plan'}
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={cancelling}
              size="sm"
              data-testid="cancel-plan-btn"
            >
              {cancelling ? 'Cancelling...' : 'Cancel plan'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
