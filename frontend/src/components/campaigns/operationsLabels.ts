import type { WaitingReason } from '@/api/campaigns';

export const WAITING_REASON_LABELS: Record<WaitingReason, string> = {
  sequence_delay: 'Waiting for the next step delay',
  outside_sending_hours: 'Outside sending hours',
  daily_limit: 'Daily limit reached',
  campaign_paused: 'Campaign paused',
  enrollment_paused: 'Lead paused',
  manual_task_pending: 'Manual task pending',
  retry_backoff: 'Retrying after failure',
  sender_unavailable: 'No ready sender',
  scheduling_unavailable: 'Scheduling unavailable',
  review_required: 'Needs review',
};

export function waitingReasonLabel(reason: WaitingReason | null | undefined): string {
  if (!reason) return '—';
  return WAITING_REASON_LABELS[reason] ?? reason;
}

/** Short relative label for "last updated" freshness notes. */
export function freshnessLabel(updatedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Overdue when a committed time already passed — needs attention, not a countdown. */
export function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}
