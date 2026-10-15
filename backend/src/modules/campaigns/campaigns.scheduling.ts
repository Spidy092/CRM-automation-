/**
 * Pure scheduling calculations for campaign operations.
 *
 * This module owns every displayed and executed send time so the overview
 * panel, lead rows, previews, and the scheduler agree on one calculation.
 * Nothing here touches the database, the queue, or the network — callers
 * supply the campaign window config, delay, and capacity counts.
 *
 * Rules (first release):
 * - Later-step delay starts from successful provider acceptance, not from
 *   opens or delivery callbacks. Manual-call steps start the next delay
 *   after task completion.
 * - Pause freezes the remaining sequence/retry delay. Resume reapplies the
 *   sending window and recomputes capacity deferrals (never a frozen reset
 *   date) without restarting completed steps.
 * - All returned instants are estimates: BullMQ delay is an eligibility
 *   threshold, not an exact execution guarantee.
 */
import {
  computeDelayToNextLocalMidnightMs,
  computeDispatchDeferralMs,
  computeSendWindowDelayMs,
  isValidTimezone,
  sendWindowFromCampaign,
} from './campaigns.sendWindow';
import type { Campaign } from './campaigns.types';

export type WaitingReason =
  | 'sequence_delay'
  | 'outside_sending_hours'
  | 'daily_limit'
  | 'campaign_paused'
  | 'enrollment_paused'
  | 'manual_task_pending'
  | 'retry_backoff'
  | 'sender_unavailable'
  | 'scheduling_unavailable'
  | 'review_required';

export interface ScheduledDue {
  /** Estimated execution instant (ISO 8601 UTC). Callers must label it estimated. */
  dueAt: string;
  /** Milliseconds from `now` until `dueAt` (>= 0). */
  delayMs: number;
  /** Which rule produced the deferral, if any. */
  deferralReason: 'send_window' | 'daily_cap' | null;
}

interface DueInput {
  /** Successful provider-acceptance instant the delay runs from (or task completion). */
  baseTime: Date;
  /** Unhurried sequence/retry delay in milliseconds (>= 0). */
  delayMs: number;
  campaign: Campaign;
  /** Messages already sent today (campaign-local day), or null when uncapped. */
  sentToday: number | null;
  now?: Date;
}

/**
 * Estimated due instant for a step: base + delay, then the campaign's
 * sending window and daily-cap rules reapplied on top.
 */
export function computeScheduledDueAt(input: DueInput): ScheduledDue {
  const now = input.now ?? new Date();
  const eligibleAt = new Date(input.baseTime.getTime() + Math.max(0, input.delayMs));
  const anchor = eligibleAt > now ? eligibleAt : now;
  const deferral = computeDispatchDeferralMs(input.campaign, input.sentToday, anchor);
  const dueAt = new Date(anchor.getTime() + deferral.delayMs);
  return {
    dueAt: dueAt.toISOString(),
    delayMs: Math.max(dueAt.getTime() - now.getTime(), 0),
    deferralReason: deferral.reason,
  };
}

/**
 * Milliseconds of a pending delay still unelapsed at `pausedAt`.
 * Never negative; a delay that already elapsed freezes at zero.
 */
export function freezeRemainingDelay(dueAt: Date, pausedAt: Date): number {
  return Math.max(dueAt.getTime() - pausedAt.getTime(), 0);
}

/**
 * Resume a frozen delay: remaining time runs from the resume instant, then
 * the sending window is reapplied and capacity deferrals are recomputed
 * against current usage (a stale pre-pause reset date is never reused).
 */
export function computeResumeDueAt(input: {
  remainingMs: number;
  resumedAt?: Date;
  campaign: Campaign;
  sentToday: number | null;
}): ScheduledDue {
  const resumedAt = input.resumedAt ?? new Date();
  const eligibleAt = new Date(resumedAt.getTime() + Math.max(0, input.remainingMs));
  const windowDelay = computeSendWindowDelayMs(sendWindowFromCampaign(input.campaign), eligibleAt);
  let dueAt = new Date(eligibleAt.getTime() + windowDelay);
  let reason: ScheduledDue['deferralReason'] = windowDelay > 0 ? 'send_window' : null;

  const limit = input.campaign.daily_send_limit;
  if (limit != null && input.sentToday != null && input.sentToday >= limit) {
    const toMidnight = computeDelayToNextLocalMidnightMs(
      input.campaign.send_window_timezone,
      dueAt,
    );
    const afterMidnight = new Date(dueAt.getTime() + toMidnight);
    const windowAfterMidnight = computeSendWindowDelayMs(
      sendWindowFromCampaign(input.campaign),
      afterMidnight,
    );
    dueAt = new Date(afterMidnight.getTime() + windowAfterMidnight);
    reason = 'daily_cap';
  }

  return {
    dueAt: dueAt.toISOString(),
    delayMs: Math.max(dueAt.getTime() - resumedAt.getTime(), 0),
    deferralReason: reason,
  };
}

export interface WaitingReasonInput {
  campaignStatus: Campaign['status'];
  enrollmentPaused: boolean;
  hasCommittedNextStep: boolean;
  nextStepChannel?: string | null;
  nextStepIsManualTask?: boolean;
  deferralReason: ScheduledDue['deferralReason'];
  sequenceDelayRemainingMs?: number;
  retryBackoffRemainingMs?: number;
  senderReady?: boolean;
  schedulingAvailable?: boolean;
  reviewRequired?: boolean;
}

/**
 * Single human-readable reason an enrollment or campaign is waiting.
 * Terminal enrollments must not call this — they show their stop reason.
 */
export function describeWaitingReason(input: WaitingReasonInput): WaitingReason | null {
  if (input.campaignStatus === 'paused') return 'campaign_paused';
  if (input.enrollmentPaused) return 'enrollment_paused';
  if (input.reviewRequired) return 'review_required';
  if (input.schedulingAvailable === false) return 'scheduling_unavailable';
  if (input.senderReady === false) return 'sender_unavailable';
  if ((input.retryBackoffRemainingMs ?? 0) > 0) return 'retry_backoff';
  if (input.nextStepIsManualTask) return 'manual_task_pending';
  if (input.deferralReason === 'daily_cap') return 'daily_limit';
  if (input.deferralReason === 'send_window') return 'outside_sending_hours';
  if ((input.sequenceDelayRemainingMs ?? 0) > 0) return 'sequence_delay';
  if (!input.hasCommittedNextStep) return null;
  return null;
}

/**
 * Potential remaining sends for an enrollment: every step after the last
 * completed one. Conditional — replies and opt-outs reduce the eventual
 * total. Terminal enrollments contribute zero.
 */
export function computePotentialRemaining(input: {
  totalSteps: number;
  completedSteps: number;
  terminal: boolean;
}): number {
  if (input.terminal) return 0;
  return Math.max(input.totalSteps - Math.max(input.completedSteps, 0), 0);
}

export interface LogLike {
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  status: string;
}

/** A message counts as sent once provider acceptance is recorded — even if it later opens or replies. */
export function isSentLog(log: LogLike): boolean {
  return log.sent_at != null;
}

export interface ReconciledCounts {
  attempts: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
  /** Failed attempts whose step has no later success — needs review/retry. */
  unresolvedFailed: number;
}

/**
 * One funnel definition shared by campaign summaries and per-step totals:
 * progress stages come from timestamp columns (a replied message still
 * counts as sent/delivered/opened); failures come from the status column.
 * Missing tracking data means unknown — never invent delivery from opens.
 */
export function reconcileLogCounts(logs: LogLike[]): ReconciledCounts {
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let replied = 0;
  let failed = 0;
  for (const log of logs) {
    if (log.sent_at != null) sent += 1;
    if (log.delivered_at != null) delivered += 1;
    if (log.opened_at != null) opened += 1;
    if (log.replied_at != null) replied += 1;
    if (log.status === 'failed') failed += 1;
  }
  return {
    attempts: logs.length,
    sent,
    delivered,
    opened,
    replied,
    failed,
    unresolvedFailed: failed,
  };
}

/**
 * First-step delay policy for the first release: the launcher sends the
 * first step immediately inside the allowed window. A nonzero configured
 * first-step delay is rejected explicitly — never silently ignored.
 */
export function firstStepDelayIssue(firstStepDelayHours: number | null | undefined): string | null {
  if (firstStepDelayHours != null && firstStepDelayHours > 0) {
    return (
      `Step 1 configures a delay of ${firstStepDelayHours}h, but scheduled first-step ` +
      `delivery is not supported in this release — the first message sends immediately ` +
      `inside the allowed sending window. Set the step 1 delay to 0 or wait for ` +
      `scheduled-first-step support.`
    );
  }
  return null;
}

/** IANA timezone label for display, e.g. "12:30 PM IST (Asia/Kolkata)". */
export function formatDueInTimezone(dueAtIso: string, timezone: string): string {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  const due = new Date(dueAtIso);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
  }).format(due);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
  }).format(due);
  return `${date} at ${time} (${tz})`;
}
