/**
 * Campaign execution service — scheduling decisions for durable operations.
 *
 * PostgreSQL (via campaigns.execution.repository) owns enrollment progress,
 * next-step timing, and execution identity. BullMQ is the wake-up transport:
 * every persisted intent is published as a delayed job carrying the opaque
 * execution id plus its scheduling generation; the worker must claim the
 * row before sending or exit without sending.
 *
 * All durable entry points no-op with `{ durable: false }` when the rollout
 * flag is off or the campaign predates migration 0084 — the caller then uses
 * the legacy transport path. Legacy and durable dispatch are never armed for
 * the same enrollment simultaneously: enabling the flag makes the durable
 * path the single scheduling owner for newly enrolled work.
 */
import { AppError } from '../../shared/middleware/errorHandler';
import { logger } from '../../shared/utils/logger';
import { enqueueOutreachDispatch } from '../../workers/queue';
import { buildTransportJobId, getOutreachDispatchJob } from '../../workers/queue';
import { computeDispatchDeferralMs } from './campaigns.sendWindow';
import { isCampaignOperationsV2Enabled } from './campaigns.rollout';
import {
  buildDedupeKey,
  claimDueStepExecutionTx,
  enrollIntentTx,
  findExpiredLeaseExecutions,
  findLatestSnapshot,
  findLatestStepExecution,
  findPendingExecution,
  findSnapshotById,
  findStaleScheduledExecutions,
  findUnscheduledDueExecutions,
  getEnrollmentState,
  hasDurableEnrollment,
  insertStepExecution,
  markExecutionFailed,
  markExecutionSent,
  markExecutionSkipped,
  markExecutionTransportScheduled,
  markExecutionUncertain,
  recordAcceptanceTx,
  releaseDailyCapacity,
  reserveDailyCapacity,
  restoreIntentTx,
  resumeEnrollmentTx,
  upsertEnrollmentState,
  type EnrollmentStateRow,
  type StepExecutionRow,
} from './campaigns.execution.repository';
import {
  computePotentialRemaining,
  computeResumeDueAt,
  computeScheduledDueAt,
  describeWaitingReason,
  firstStepDelayIssue,
  type ScheduledDue,
  type WaitingReason,
} from './campaigns.scheduling';
import { findCampaignById, countSentTodayForCampaign } from './campaigns.repository';
import { findSequenceById } from '../outreach/outreach.repository';
import { findTemplateById } from '../templates/templates.repository';
import { findLeadById } from '../leads/leads.repository';
import type { Campaign } from './campaigns.types';
import type { SequenceStep } from '../outreach/outreach.types';

export const EXECUTION_LEASE_MS = 5 * 60 * 1000;
const RECOVERY_BATCH_LIMIT = 100;

export interface DispatchGate {
  eligible: boolean;
  /** Machine-readable reason when ineligible — doubles as the waiting reason. */
  reason:
    | WaitingReason
    | 'campaign_inactive'
    | 'not_enrolled'
    | 'lead_ineligible'
    | 'template_unapproved'
    | 'stale_generation'
    | 'duplicate'
    | null;
  detail?: string;
}

/**
 * Authoritative pre-send gate. Applies to first dispatches, follow-ups,
 * manual retries, and already-claimed worker jobs: campaign state,
 * enrollment membership, lead eligibility, opt-out/reply stops, and template
 * approval are all rechecked at execution time.
 */
export async function evaluateDispatchGate(input: {
  campaignId: string;
  leadId: string;
  stepNumber: number;
  templateId: string | null;
  expectedGeneration?: number | null;
}): Promise<DispatchGate> {
  const campaign = await findCampaignById(input.campaignId);
  if (!campaign || campaign.status !== 'active') {
    return {
      eligible: false,
      reason: 'campaign_inactive',
      detail: 'Campaign is not active.',
    };
  }

  const enrollment =
    isCampaignOperationsV2Enabled() || input.expectedGeneration != null
      ? await getEnrollmentState(input.campaignId, input.leadId).catch(() => null)
      : null;
  if (enrollment) {
    if (enrollment.enrollment_status !== 'active') {
      return {
        eligible: false,
        reason: enrollment.enrollment_status === 'paused' ? 'enrollment_paused' : 'not_enrolled',
        detail:
          enrollment.enrollment_status === 'paused'
            ? 'Enrollment is paused.'
            : `Enrollment is ${enrollment.enrollment_status}.`,
      };
    }
    if (
      input.expectedGeneration != null &&
      enrollment.scheduling_generation !== input.expectedGeneration
    ) {
      return {
        eligible: false,
        reason: 'stale_generation',
        detail: 'Scheduling generation changed (pause/resume) — this job is stale.',
      };
    }
  } else {
    const membership = await isLeadEnrolled(input.campaignId, input.leadId);
    if (!membership) {
      return { eligible: false, reason: 'not_enrolled', detail: 'Lead is not enrolled.' };
    }
  }

  const lead = await findLeadById(input.leadId);
  if (!lead || lead.status !== 'active') {
    return {
      eligible: false,
      reason: 'lead_ineligible',
      detail: lead ? `Lead status is ${lead.status}.` : 'Lead not found.',
    };
  }

  // Reply / opt-out stops are mandatory. Replies are observed through
  // outreach history; opt-outs through lead status (checked above).
  const { findLogsByLead } = await import('../outreach/outreach.repository');
  const logs = (await findLogsByLead(input.leadId, 200)) ?? [];
  const campaignLogs = logs.filter((l) => l.campaign_id === input.campaignId);
  if (campaignLogs.some((l) => l.status === 'replied' || l.replied_at != null)) {
    return {
      eligible: false,
      reason: 'lead_ineligible',
      detail: 'Lead replied — sequence stopped.',
    };
  }

  if (input.templateId) {
    const template = await findTemplateById(input.templateId);
    if (!template || template.approval_status !== 'approved') {
      return {
        eligible: false,
        reason: 'template_unapproved',
        detail: 'Template is not approved.',
      };
    }
  }

  return { eligible: true, reason: null };
}

async function isLeadEnrolled(campaignId: string, leadId: string): Promise<boolean> {
  const { findCampaignLeadRows } = await import('./campaigns.repository');
  const rows = await findCampaignLeadRows(campaignId);
  return rows.some((r) => r.id === leadId);
}

/** Current campaign-local day (YYYY-MM-DD) in the campaign's timezone. */
export function campaignLocalDate(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Atomically reserve one daily campaign send. Concurrent workers serialize
 * on the capacity row — the limit cannot overshoot. Returns false when the
 * campaign-local day is already at capacity (caller defers to next midnight).
 */
export async function tryReserveCapacity(campaign: Campaign): Promise<boolean> {
  if (campaign.daily_send_limit == null) return true;
  return reserveDailyCapacity(
    campaign.id,
    campaignLocalDate(campaign.send_window_timezone || 'UTC'),
    campaign.daily_send_limit,
  );
}

export async function releaseCapacity(campaign: Campaign): Promise<void> {
  if (campaign.daily_send_limit == null) return;
  await releaseDailyCapacity(
    campaign.id,
    campaignLocalDate(campaign.send_window_timezone || 'UTC'),
  );
}

export interface EnrollmentIntent {
  durable: boolean;
  snapshotId: string | null;
  dedupeKey: string | null;
  due: ScheduledDue | null;
}

/**
 * Pin the sequence version for an enrollment and persist its next-step
 * intent. The enrollment row and the first execution commit atomically, so
 * a crash can never leave an active enrollment with no intent.
 * Idempotent: repeated calls for the same step+generation return the
 * existing intent instead of scheduling twice.
 */
export async function enrollWithIntent(input: {
  campaign: Campaign;
  leadId: string;
  steps: SequenceStep[];
  sequenceId: string;
  baseTime?: Date;
  now?: Date;
  mockMode?: boolean;
}): Promise<EnrollmentIntent> {
  if (!isCampaignOperationsV2Enabled())
    return { durable: false, snapshotId: null, dedupeKey: null, due: null };

  const now = input.now ?? new Date();
  const baseTime = input.baseTime ?? now;
  const mockMode = input.mockMode ?? false;
  const snapshot = await findLatestSnapshot(input.campaign.id).catch(() => null);
  const pinned =
    snapshot && JSON.stringify(snapshot.steps) === JSON.stringify(input.steps)
      ? snapshot
      : await import('./campaigns.execution.repository').then((repo) =>
          repo.ensureSequenceSnapshot(input.campaign.id, input.sequenceId, input.steps),
        );

  const firstStep = [...input.steps].sort((a, b) => a.stepNumber - b.stepNumber)[0];
  if (!firstStep) throw new AppError('Outreach sequence has no steps.', 400);
  const delayIssue = firstStepDelayIssue(firstStep.delayHours);
  if (delayIssue) throw new AppError(delayIssue, 400);

  const sentToday =
    input.campaign.daily_send_limit != null
      ? await countSentTodayForCampaign(
          input.campaign.id,
          input.campaign.send_window_timezone || 'UTC',
        )
      : null;
  const due = computeScheduledDueAt({
    baseTime,
    delayMs: 0,
    campaign: input.campaign,
    sentToday,
    now,
  });

  const existing = await lookupEnrollment(input.campaign.id, input.leadId);
  const generation = existing?.scheduling_generation ?? 0;
  const { dedupeKey, inserted } = await enrollIntentTx({
    campaignId: input.campaign.id,
    leadId: input.leadId,
    snapshotId: pinned.id,
    firstStepNumber: firstStep.stepNumber,
    firstDueAt: due.dueAt,
    channel: firstStep.channel,
    templateId: firstStep.templateId,
    generation,
    mockMode,
  });
  void inserted;

  return { durable: true, snapshotId: pinned.id, dedupeKey, due };
}

/**
 * Publish a persisted intent to the transport. The BullMQ job carries the
 * opaque execution id plus generation; publication failure leaves the row
 * unscheduled so the recovery sweep retries it — no silent loss.
 */
export async function publishExecution(input: {
  dedupeKey: string;
  leadId: string;
  campaignId: string;
  sequenceId: string;
  stepNumber: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  templateId: string;
  generation: number;
  delayMs: number;
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
}): Promise<{ published: boolean }> {
  if (!isCampaignOperationsV2Enabled()) return { published: false };
  const transportJobId = buildTransportJobId(input.dedupeKey);
  let fullJobId: string;
  try {
    fullJobId = await enqueueOutreachDispatch(
      {
        leadId: input.leadId,
        campaignId: input.campaignId,
        sequenceId: input.sequenceId,
        stepNumber: input.stepNumber,
        channel: input.channel,
        templateId: input.templateId,
        mockMode: input.mockMode,
        aiPersonalizationEnabled: input.aiPersonalizationEnabled,
        executionId: input.dedupeKey,
        generation: input.generation,
      },
      { jobIdSuffix: transportJobId, delayMs: input.delayMs > 0 ? input.delayMs : undefined },
    );
  } catch (err) {
    logger.error('Failed to publish campaign execution intent', {
      campaignId: input.campaignId,
      leadId: input.leadId,
      dedupeKey: input.dedupeKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return { published: false };
  }
  // The full BullMQ job ID is stored so recovery can tell a live transport
  // record apart from a retained completed one.
  await markExecutionTransportScheduled(input.dedupeKey, fullJobId);
  return { published: true };
}

/**
 * Record provider acceptance, advance the enrollment, and persist the next
 * scheduling intent in ONE database transaction; the transport job is
 * published only after commit. This closes the crash window that used to
 * strand a sent execution without its follow-up: a pre-commit crash leaves
 * the execution claimed (lease expiry → explicit uncertain outcome), and a
 * post-commit crash leaves an unscheduled intent the sweep republishes
 * without resending the accepted message.
 */
export async function recordAcceptance(input: {
  campaign: Campaign;
  enrollment: EnrollmentStateRow;
  execution: StepExecutionRow;
  providerMsgId: string | null;
  steps: SequenceStep[];
  sequenceId: string;
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
  acceptedAt?: Date;
}): Promise<void> {
  const acceptedAt = input.acceptedAt ?? new Date();
  const ordered = [...input.steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const currentIdx = ordered.findIndex((s) => s.stepNumber === input.execution.step_number);
  const next = ordered[currentIdx + 1];
  const completedSteps = Math.max(input.enrollment.completed_steps, currentIdx + 1);

  let nextIntent: {
    stepNumber: number;
    channel: SequenceStep['channel'];
    templateId: string;
    generation: number;
    attempt: number;
    dueAt: string;
  } | null = null;
  let delayMs = 0;
  if (next) {
    const sentToday =
      input.campaign.daily_send_limit != null
        ? await countSentTodayForCampaign(
            input.campaign.id,
            input.campaign.send_window_timezone || 'UTC',
          )
        : null;
    const due = computeScheduledDueAt({
      baseTime: acceptedAt,
      delayMs: (next.delayHours ?? 24) * 3_600_000,
      campaign: input.campaign,
      sentToday,
      now: acceptedAt,
    });
    delayMs = due.delayMs;
    nextIntent = {
      stepNumber: next.stepNumber,
      channel: next.channel,
      templateId: next.templateId,
      generation: input.enrollment.scheduling_generation,
      attempt: 0,
      dueAt: due.dueAt,
    };
  }

  const { advanced, nextDedupeKey } = await recordAcceptanceTx({
    dedupeKey: input.execution.dedupe_key,
    providerMsgId: input.providerMsgId,
    campaignId: input.campaign.id,
    leadId: input.enrollment.lead_id,
    snapshotId: input.execution.snapshot_id,
    completedSteps,
    terminalStopReason: 'sequence_completed',
    next: nextIntent,
  });
  if (!advanced || !nextIntent || !nextDedupeKey) return;

  // Publish only after commit. The next intent inherits the accepted
  // execution's dispatch mode — simulated work stays simulated.
  await publishExecution({
    dedupeKey: nextDedupeKey,
    leadId: input.enrollment.lead_id,
    campaignId: input.campaign.id,
    sequenceId: input.sequenceId,
    stepNumber: nextIntent.stepNumber,
    channel: nextIntent.channel,
    templateId: nextIntent.templateId,
    generation: nextIntent.generation,
    delayMs,
    mockMode: input.execution.mock_mode ?? input.mockMode,
    aiPersonalizationEnabled: input.aiPersonalizationEnabled,
  }).catch(() => ({ published: false }));
}

/**
 * Resume: recompute each frozen delay from its preserved remainder, reapply
 * sending windows, and recompute capacity deferrals against current usage.
 * Enrollments paused individually stay paused. Legacy rows with unrecoverable
 * timing keep timing_unknown and require an explicit resume schedule.
 */
export async function restoreForResume(input: {
  campaign: Campaign;
  enrollments: EnrollmentStateRow[];
  resumedAt?: Date;
  defaultDelayMs?: number;
}): Promise<{ restored: number; unknownTiming: number }> {
  const resumedAt = input.resumedAt ?? new Date();
  let restored = 0;
  let unknownTiming = 0;
  const sentToday =
    input.campaign.daily_send_limit != null
      ? await countSentTodayForCampaign(
          input.campaign.id,
          input.campaign.send_window_timezone || 'UTC',
        )
      : null;

  for (const enrollment of input.enrollments) {
    if (enrollment.enrollment_status !== 'active') continue;
    const remaining =
      enrollment.delay_remaining_ms != null ? Number(enrollment.delay_remaining_ms) : null;
    if (remaining == null || enrollment.timing_unknown) {
      unknownTiming += 1;
      continue;
    }
    const due = computeResumeDueAt({
      remainingMs: remaining,
      resumedAt,
      campaign: input.campaign,
      sentToday,
    });
    const snapshot = enrollment.sequence_snapshot_id
      ? await findSnapshotById(enrollment.sequence_snapshot_id).catch(() => null)
      : null;
    const steps = snapshot?.steps ?? [];
    const next = steps.find((s) => s.stepNumber === enrollment.next_step_number);
    if (next && enrollment.next_step_number != null) {
      // Enrollment timing and intent commit together; publication follows.
      // The restored intent keeps the enrollment's dispatch mode.
      const restored = await restoreIntentTx({
        campaignId: input.campaign.id,
        leadId: enrollment.lead_id,
        nextDueAt: due.dueAt,
        execution: {
          stepNumber: enrollment.next_step_number,
          channel: next.channel,
          templateId: next.templateId,
          snapshotId: enrollment.sequence_snapshot_id,
          mockMode: enrollment.mock_mode ?? false,
          generation: enrollment.scheduling_generation,
        },
      });
      if (restored && 'skipped' in restored) continue;
      if (restored?.nextDedupeKey) {
        // Publication failure is recoverable: the intent row stays unscheduled
        // for the sweep, so resume never silently drops work.
        await publishExecution({
          dedupeKey: restored.nextDedupeKey,
          leadId: enrollment.lead_id,
          campaignId: input.campaign.id,
          sequenceId: snapshot?.sequence_id ?? '',
          stepNumber: enrollment.next_step_number,
          channel: next.channel,
          templateId: next.templateId,
          generation: enrollment.scheduling_generation,
          delayMs: due.delayMs,
          mockMode: enrollment.mock_mode ?? false,
        }).catch(() => ({ published: false }));
      }
    } else {
      await upsertEnrollmentState(input.campaign.id, enrollment.lead_id, {
        nextDueAt: due.dueAt,
        delayRemainingMs: null,
      });
    }
    restored += 1;
  }
  return { restored, unknownTiming };
}

/**
 * Republish one durable intent. A retained completed/failed transport record
 * (BullMQ dedupes re-adds against it instead of executing) is removed first
 * so recovery actually schedules work; a live record (waiting/delayed/active)
 * is left alone so concurrent sweeps cannot multiply transport jobs. Either
 * way the database claim remains the single dispatch guard — no send can
 * bypass it.
 */
async function republishCandidate(execution: StepExecutionRow): Promise<boolean> {
  const enrollment = await getEnrollmentState(execution.campaign_id, execution.lead_id).catch(
    () => null,
  );
  if (!enrollment || enrollment.enrollment_status !== 'active') {
    await markExecutionSkipped(execution.dedupe_key, 'enrollment not active during recovery');
    return false;
  }
  if (execution.transport_job_id) {
    const existing = await getOutreachDispatchJob(execution.transport_job_id).catch(() => null);
    if (existing) {
      if (existing.state === 'completed' || existing.state === 'failed') {
        await existing.remove();
      } else {
        // Live transport record — the wake-up is already queued.
        return false;
      }
    }
  }
  const snapshot = execution.snapshot_id
    ? await findSnapshotById(execution.snapshot_id).catch(() => null)
    : null;
  const published = await publishExecution({
    dedupeKey: execution.dedupe_key,
    leadId: execution.lead_id,
    campaignId: execution.campaign_id,
    sequenceId: snapshot?.sequence_id ?? '',
    stepNumber: execution.step_number,
    channel: execution.channel as 'whatsapp' | 'email' | 'sms' | 'phone_call',
    templateId: execution.template_id ?? '',
    generation: execution.generation,
    delayMs: Math.max(
      (execution.due_at ? new Date(execution.due_at).getTime() : Date.now()) - Date.now(),
      0,
    ),
    mockMode: execution.mock_mode ?? false,
  });
  return published.published;
}

/**
 * Recovery sweep: republish durable intents lost to publication failures,
 * worker interruption, flag-off parking, or retained completed transport
 * records, and convert expired leases into explicit uncertain outcomes for
 * review. Bounded — never scans the whole queue per call. Republished work
 * keeps its persisted dispatch mode.
 */
export async function sweepRecovery(input?: {
  limit?: number;
  workerId?: string;
}): Promise<{ republished: number; uncertain: number }> {
  const limit = input?.limit ?? RECOVERY_BATCH_LIMIT;
  const workerId = input?.workerId ?? `recovery-${process.pid}`;
  let republished = 0;
  let uncertain = 0;

  const unscheduled = await findUnscheduledDueExecutions(limit);
  const staleScheduled = await findStaleScheduledExecutions(limit);
  const seen = new Set<string>();
  const candidates = [...unscheduled, ...staleScheduled].filter((execution) => {
    if (seen.has(execution.dedupe_key)) return false;
    seen.add(execution.dedupe_key);
    return true;
  });
  for (const execution of candidates) {
    const campaign = await findCampaignById(execution.campaign_id).catch(() => null);
    if (!campaign || campaign.status !== 'active') {
      await markExecutionSkipped(execution.dedupe_key, 'campaign not active during recovery');
      continue;
    }
    if (await republishCandidate(execution)) republished += 1;
  }

  const expired = await findExpiredLeaseExecutions(limit);
  for (const execution of expired) {
    // The worker died after claiming: the provider may have accepted the
    // message. Mark uncertain for review instead of blindly resending.
    await markExecutionUncertain(
      execution.dedupe_key,
      `Worker ${execution.claimed_by ?? 'unknown'} lease expired before an outcome was recorded.`,
    );
    uncertain += 1;
    logger.warn('campaign execution lease expired — marked uncertain for review', {
      dedupeKey: execution.dedupe_key,
      campaignId: execution.campaign_id,
      leadId: execution.lead_id,
      workerId,
    });
  }

  return { republished, uncertain };
}

/**
 * Create a manual-retry intent for a failed step. Rejected while the
 * campaign is paused; never retries an uncertain delivery automatically.
 *
 * Attempt identities allocate atomically: the next attempt number derives
 * from the latest same-generation execution, and the unique dedupe key
 * decides concurrent races — losers recheck and report the winner as a
 * duplicate instead of scheduling twice. An intentional new retry after a
 * terminal failure therefore always gets a fresh attempt, while concurrent
 * double-clicks collapse to one pending execution.
 */
export async function createRetryIntent(input: {
  campaign: Campaign;
  leadId: string;
  stepNumber: number;
  channel: SequenceStep['channel'];
  templateId: string;
  generation: number;
  snapshotId: string | null;
  existingPending: StepExecutionRow | null;
}): Promise<{ dedupeKey: string; duplicate: boolean; attempt: number | null; mockMode: boolean }> {
  if (input.campaign.status === 'paused') {
    throw new AppError('Campaign is paused — resume it before retrying a send.', 409);
  }
  if (input.campaign.status !== 'active') {
    throw new AppError('Campaign must be active to retry a send.', 400);
  }
  const enrollment = await getEnrollmentState(input.campaign.id, input.leadId).catch(() => null);
  if (enrollment) {
    if (enrollment.enrollment_status === 'paused') {
      throw new AppError('Enrollment is paused — resume it before retrying a send.', 409);
    }
    if (enrollment.enrollment_status !== 'active') {
      throw new AppError(`Enrollment is ${enrollment.enrollment_status} — cannot retry.`, 400);
    }
  }
  let lead: { status?: string } | null = null;
  try {
    const leadsRepo = await import('../leads/leads.repository');
    if (typeof leadsRepo.findLeadById === 'function') {
      lead = await leadsRepo.findLeadById(input.leadId);
    }
  } catch {
    // fallback
  }
  if (!lead) {
    try {
      const leadsService = await import('../leads/leads.service');
      if (typeof leadsService.getLeadsByIds === 'function') {
        const [found] = (await leadsService.getLeadsByIds([input.leadId])) ?? [];
        lead = found ?? null;
      }
    } catch {
      // ignore
    }
  }
  if (lead) {
    if (lead.status === 'opted_out') {
      throw new AppError('Lead has opted out — cannot retry outreach.', 400);
    }
    if (lead.status !== 'active') {
      throw new AppError(`Lead is ${lead.status} — cannot retry outreach.`, 400);
    }
  }
  if (input.existingPending) {
    return {
      dedupeKey: input.existingPending.dedupe_key,
      duplicate: true,
      attempt: null,
      mockMode: input.existingPending.mock_mode ?? false,
    };
  }
  for (let round = 0; round < 3; round += 1) {
    const latest = await findLatestStepExecution(
      input.campaign.id,
      input.leadId,
      input.stepNumber,
      input.generation,
    );
    if (latest?.state === 'uncertain') {
      throw new AppError(
        'This send has an uncertain outcome — resolve it in review before retrying.',
        422,
      );
    }
    if (latest?.state === 'sent') {
      throw new AppError('This step was already sent — nothing to retry.', 409);
    }
    // A concurrent request may have won since the caller checked: collapse
    // to its pending execution instead of scheduling twice.
    const pending = await findPendingExecution(
      input.campaign.id,
      input.leadId,
      input.stepNumber,
      input.generation,
    );
    if (pending) {
      return {
        dedupeKey: pending.dedupe_key,
        duplicate: true,
        attempt: null,
        mockMode: pending.mock_mode ?? false,
      };
    }
    const attempt = parseAttemptNumber(latest?.dedupe_key) + 1;
    const snapshotId = latest?.snapshot_id ?? input.snapshotId;
    const mockMode = latest?.mock_mode ?? false;
    const dedupeKey = buildDedupeKey({
      campaignId: input.campaign.id,
      leadId: input.leadId,
      snapshotId,
      stepNumber: input.stepNumber,
      generation: input.generation,
      attempt,
    });
    const inserted = await insertStepExecution({
      campaignId: input.campaign.id,
      leadId: input.leadId,
      snapshotId,
      stepNumber: input.stepNumber,
      channel: input.channel,
      templateId: input.templateId,
      generation: input.generation,
      attempt,
      dueAt: new Date().toISOString(),
      mockMode,
      manualOverride: true,
      overrideProvenance: 'manual_retry',
    });
    if (inserted) return { dedupeKey, duplicate: false, attempt, mockMode };
  }
  // Another request won every round — report its work, not a silent no-op.
  const pending = await findPendingExecution(
    input.campaign.id,
    input.leadId,
    input.stepNumber,
    input.generation,
  );
  if (pending) {
    return {
      dedupeKey: pending.dedupe_key,
      duplicate: true,
      attempt: null,
      mockMode: pending.mock_mode ?? false,
    };
  }
  throw new AppError('Could not allocate retry attempt — nothing was scheduled.', 409);
}

/** Attempt number encoded in a dedupe key (`:a<N>` suffix); unknown shapes start at zero. */
export function parseAttemptNumber(dedupeKey: string | null | undefined): number {
  if (!dedupeKey) return 0;
  const match = /:a(\d+)$/.exec(dedupeKey);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Resume one enrollment through the shared scheduling rules: the frozen
 * remainder is recomputed with sending windows and current capacity (or an
 * explicit schedule is used for unknown timing), and a current-generation
 * execution is persisted atomically with the state transition, then
 * published. A duplicate resume finds an active enrollment and reports a
 * conflict instead of scheduling twice. Campaign-level resume never touches
 * rows paused here.
 */
export async function resumeSingleEnrollment(input: {
  campaign: Campaign;
  enrollment: EnrollmentStateRow;
  explicitDueAt?: string;
  resumedAt?: Date;
  sequenceId?: string;
}): Promise<{ status: string; nextDueAt: string | null; nextDedupeKey: string | null }> {
  const enrollment = input.enrollment;
  if (enrollment.enrollment_status !== 'paused') {
    throw new AppError('Only paused enrollments can be resumed.', 409);
  }
  const resumedAt = input.resumedAt ?? new Date();
  const remaining =
    enrollment.delay_remaining_ms != null ? Number(enrollment.delay_remaining_ms) : null;

  let dueAt: string;
  let clearUnknown = false;
  if (input.explicitDueAt) {
    dueAt = new Date(input.explicitDueAt).toISOString();
    clearUnknown = true;
  } else {
    if (remaining == null || enrollment.timing_unknown) {
      throw new AppError(
        'This enrollment lost its timing while paused — resume with an explicit schedule.',
        422,
      );
    }
    const sentToday =
      input.campaign.daily_send_limit != null
        ? await countSentTodayForCampaign(
            input.campaign.id,
            input.campaign.send_window_timezone || 'UTC',
          )
        : null;
    dueAt = computeResumeDueAt({
      remainingMs: remaining,
      resumedAt,
      campaign: input.campaign,
      sentToday,
    }).dueAt;
  }

  const snapshot = enrollment.sequence_snapshot_id
    ? await findSnapshotById(enrollment.sequence_snapshot_id).catch(() => null)
    : null;
  const steps = snapshot?.steps ?? [];
  const next = steps.find((s) => s.stepNumber === enrollment.next_step_number);

  const resumed = await resumeEnrollmentTx({
    campaignId: input.campaign.id,
    leadId: enrollment.lead_id,
    expectedGeneration: enrollment.scheduling_generation,
    computedDueAt: dueAt,
    clearTimingUnknown: clearUnknown,
    execution:
      next && enrollment.next_step_number != null
        ? {
            stepNumber: enrollment.next_step_number,
            channel: next.channel,
            templateId: next.templateId,
            snapshotId: enrollment.sequence_snapshot_id,
            mockMode: enrollment.mock_mode ?? false,
          }
        : null,
  });
  if (!resumed) {
    throw new AppError('Enrollment changed — reload and retry with the latest version.', 409);
  }

  if (resumed.nextDedupeKey && next && enrollment.next_step_number != null) {
    await publishExecution({
      dedupeKey: resumed.nextDedupeKey,
      leadId: enrollment.lead_id,
      campaignId: input.campaign.id,
      sequenceId: snapshot?.sequence_id ?? input.sequenceId ?? '',
      stepNumber: enrollment.next_step_number,
      channel: next.channel,
      templateId: next.templateId,
      generation: resumed.enrollment.scheduling_generation,
      delayMs: Math.max(new Date(dueAt).getTime() - resumedAt.getTime(), 0),
      mockMode: enrollment.mock_mode ?? false,
    }).catch(() => ({ published: false }));
  }
  return {
    status: resumed.enrollment.enrollment_status,
    nextDueAt: resumed.enrollment.next_due_at,
    nextDedupeKey: resumed.nextDedupeKey,
  };
}

export { findPendingExecution } from './campaigns.execution.repository';

/** Next-step intent after a phone-call task completes — exactly one, idempotent. */
export async function scheduleAfterPhoneTask(input: {
  campaign: Campaign;
  leadId: string;
  sequenceId: string;
  completedStepNumber: number;
  completedAt?: Date;
}): Promise<{ owned: boolean; scheduled: boolean; duplicate: boolean }> {
  const owned = await hasDurableEnrollment(input.campaign.id, input.leadId);
  if (!owned) return { owned: false, scheduled: false, duplicate: false };

  const enrollment = await getEnrollmentState(input.campaign.id, input.leadId);
  if (
    !enrollment ||
    enrollment.enrollment_status !== 'active' ||
    input.campaign.status !== 'active'
  ) {
    return { owned: true, scheduled: false, duplicate: false };
  }
  if (!enrollment.sequence_snapshot_id) {
    throw new AppError('Durable campaign enrollment is missing its sequence snapshot', 500);
  }
  const snapshot = await findSnapshotById(enrollment.sequence_snapshot_id);
  if (!snapshot || !Array.isArray(snapshot.steps)) {
    throw new AppError('Durable campaign enrollment sequence snapshot was not found', 500);
  }
  const next = [...snapshot.steps]
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .find((step) => step.stepNumber === input.completedStepNumber + 1);
  if (!next) return { owned: true, scheduled: false, duplicate: false };

  const generation = enrollment.scheduling_generation;
  const completedAt = input.completedAt ?? new Date();
  const sentToday =
    input.campaign.daily_send_limit != null
      ? await countSentTodayForCampaign(
          input.campaign.id,
          input.campaign.send_window_timezone || 'UTC',
        )
      : null;
  const due = computeScheduledDueAt({
    baseTime: completedAt,
    delayMs: (next.delayHours ?? 24) * 3_600_000,
    campaign: input.campaign,
    sentToday,
    now: completedAt,
  });
  const restored = await restoreIntentTx({
    campaignId: input.campaign.id,
    leadId: input.leadId,
    nextDueAt: due.dueAt,
    nextStepNumber: next.stepNumber,
    completedSteps: Math.max(enrollment.completed_steps, input.completedStepNumber),
    execution: {
      stepNumber: next.stepNumber,
      channel: next.channel,
      templateId: next.templateId,
      snapshotId: enrollment.sequence_snapshot_id,
      mockMode: enrollment.mock_mode,
      generation,
    },
  });
  if (!restored) return { owned: true, scheduled: false, duplicate: true };
  if ('skipped' in restored) return { owned: true, scheduled: false, duplicate: false };

  // Publication failure is recoverable: the intent row stays unscheduled for
  // the sweep. The durable row remains the only owner even if the flag is off.
  await publishExecution({
    dedupeKey: restored.nextDedupeKey,
    leadId: input.leadId,
    campaignId: input.campaign.id,
    sequenceId: input.sequenceId,
    stepNumber: next.stepNumber,
    channel: next.channel,
    templateId: next.templateId,
    generation,
    delayMs: due.delayMs,
    mockMode: enrollment.mock_mode,
  }).catch(() => ({ published: false }));
  return { owned: true, scheduled: true, duplicate: false };
}

export async function recordClaimedOutcome(input: {
  dedupeKey: string;
  campaign: Campaign;
  outcome: 'sent' | 'failed' | 'uncertain';
  providerMsgId?: string | null;
  errorCategory?: string;
  errorMessage?: string;
}): Promise<void> {
  if (input.outcome === 'sent') {
    await markExecutionSent(input.dedupeKey, input.providerMsgId ?? null);
    return;
  }
  if (input.outcome === 'uncertain') {
    await markExecutionUncertain(
      input.dedupeKey,
      input.errorMessage ?? 'Uncertain provider outcome.',
    );
    return;
  }
  await markExecutionFailed(
    input.dedupeKey,
    input.errorCategory ?? 'provider_error',
    input.errorMessage ?? 'Unknown dispatch error',
  );
  // Definite failures release the reserved slot so it can be reused.
  await releaseCapacity(input.campaign).catch(() => undefined);
}

export async function claimExecutionForWorker(input: {
  dedupeKey: string;
  expectedGeneration: number;
  workerId: string;
}): Promise<StepExecutionRow | null> {
  return claimDueStepExecutionTx({
    dedupeKey: input.dedupeKey,
    expectedGeneration: input.expectedGeneration,
    workerId: input.workerId,
    leaseMs: EXECUTION_LEASE_MS,
  });
}

/**
 * Release a claim so a BullMQ retry can reclaim it. Called when the worker
 * throws before recording an outcome (transient path).
 */
export async function releaseClaimForRetry(dedupeKey: string): Promise<void> {
  const { pool } = await import('../../shared/utils/db');
  await pool.query(
    `UPDATE campaign_step_executions
        SET state = 'scheduled', lease_expires_at = NULL, claimed_by = NULL, updated_at = NOW()
      WHERE dedupe_key = $1 AND state = 'claimed'`,
    [dedupeKey],
  );
}

/** Resolve pinned steps for an execution, falling back to the live sequence. */
export async function resolveExecutionSteps(input: {
  snapshotId: string | null;
  sequenceId: string;
}): Promise<SequenceStep[]> {
  if (input.snapshotId) {
    const snapshot = await findSnapshotById(input.snapshotId).catch(() => null);
    if (snapshot && Array.isArray(snapshot.steps) && snapshot.steps.length > 0) {
      return snapshot.steps;
    }
  }
  const sequence = await findSequenceById(input.sequenceId);
  if (!sequence || !Array.isArray(sequence.steps)) {
    throw new AppError(`Sequence ${input.sequenceId} not found`, 404);
  }
  return sequence.steps;
}

export function summarizePotentialRemaining(input: {
  totalSteps: number;
  completedSteps: number;
  terminal: boolean;
}): number {
  return computePotentialRemaining(input);
}

export function waitingReasonFor(
  input: Parameters<typeof describeWaitingReason>[0],
): WaitingReason | null {
  return describeWaitingReason(input);
}

export function deferralFor(
  campaign: Campaign,
  sentToday: number | null,
  now: Date = new Date(),
): { delayMs: number; reason: 'send_window' | 'daily_cap' | null } {
  return computeDispatchDeferralMs(campaign, sentToday, now);
}

export async function lookupCampaign(campaignId: string): Promise<Campaign | null> {
  return findCampaignById(campaignId);
}

export async function lookupSequenceSteps(sequenceId: string): Promise<SequenceStep[] | null> {
  const sequence = await findSequenceById(sequenceId).catch(() => null);
  if (!sequence || !Array.isArray(sequence.steps)) return null;
  return sequence.steps;
}

export async function lookupEnrollment(
  campaignId: string,
  leadId: string,
): Promise<EnrollmentStateRow | null> {
  try {
    return await getEnrollmentState(campaignId, leadId);
  } catch {
    return null;
  }
}
