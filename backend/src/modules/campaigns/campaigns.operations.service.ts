/**
 * Campaign operations read models and enrollment controls.
 *
 * Serves the operational APIs: overview, committed schedule, activity, and
 * paginated enrollment progress. Every displayed time comes from the shared
 * scheduling calculation — never from campaign names or last activity.
 * Committed next actions (persisted intents) are always distinguished from
 * projected future steps.
 */
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { decodeCursor, encodeCursor } from '../../shared/utils/pagination';
import { logger } from '../../shared/utils/logger';
import {
  countExecutionsByState,
  countAttentionItems,
  findCampaignActivity,
  findCommittedSchedule,
  findEnrollmentsPage,
  findNextCommittedActivity,
  getEnrollmentState,
  listAllEnrollmentStates,
  pauseEnrollmentState,
  summarizeCampaigns,
  type EnrollmentOperationsRow,
} from './campaigns.execution.repository';
import { resumeSingleEnrollment } from './campaigns.execution.service';
import {
  computePotentialRemaining,
  describeWaitingReason,
  formatDueInTimezone,
  type WaitingReason,
} from './campaigns.scheduling';
import { computeDispatchDeferralMs } from './campaigns.sendWindow';
import { isCampaignOperationsV2Enabled } from './campaigns.rollout';
import {
  countSentTodayForCampaign,
  findCampaignById,
  getCampaignStats,
} from './campaigns.repository';
import { findSequenceById } from '../outreach/outreach.repository';
import { findByName as findIntegrationByName } from '../integrations/integrations.repository';
import { getLeadById as getLeadByIdService, assertAccess } from '../leads/leads.service';
import type { Campaign } from './campaigns.types';
import type { SequenceStep } from '../outreach/outreach.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export interface OperationsNextActivity {
  kind: 'committed';
  leadId: string;
  businessName: string | null;
  stepNumber: number;
  channel: string;
  dueAt: string;
  dueLabel: string;
}

export interface OperationsOverview {
  campaignId: string;
  status: Campaign['status'];
  timezone: string;
  durable: boolean;
  nextActivity: OperationsNextActivity | null;
  scheduledCount: number;
  potentialRemaining: number;
  sentToday: number;
  dailyLimit: number | null;
  capacityRemaining: number | null;
  attempts: number;
  failedUnresolved: number;
  uncertain: number;
  executionsByState: Array<{ state: string; channel: string; count: number }>;
  waitingReasons: Array<{ reason: WaitingReason; count: number }>;
  attention: Array<{
    kind: 'failed' | 'uncertain' | 'unknown_timing';
    count: number;
    label: string;
  }>;
  computedAt: string;
}

export interface ScheduleCommittedItem {
  leadId: string;
  businessName: string | null;
  stepNumber: number;
  channel: string;
  state: string;
  dueAt: string | null;
  dueLabel: string | null;
}

export interface ScheduleProjectedItem {
  leadId: string;
  stepNumber: number;
  channel: string;
  estimatedDueAt: string;
  estimatedDueLabel: string;
}

export interface EnrollmentProgressItem {
  leadId: string;
  businessName: string | null;
  contactName: string | null;
  leadStatus: string;
  enrollmentStatus: string;
  completedSteps: number;
  totalSteps: number | null;
  nextAction: {
    kind: 'committed' | 'projected';
    stepNumber: number;
    channel: string;
    dueAt: string | null;
    dueLabel: string | null;
  } | null;
  waitingReason: WaitingReason | null;
  waitingDetail: string | null;
  terminalReason: string | null;
  lastActivity: { at: string; status: string } | null;
  openTasks: number;
  schedulingGeneration: number;
  timingUnknown: boolean;
  actions: { pause: boolean; resume: boolean; retry: boolean; reschedule: boolean };
}

async function loadCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);
  return campaign;
}

function toLeadActor(actor: Actor): {
  id: string;
  role: 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';
  ipAddress?: string | null;
} {
  return {
    id: actor.id,
    role: actor.role as 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer',
    ipAddress: actor.ipAddress ?? null,
  };
}

function canMutateEnrollment(actor: Actor): boolean {
  return actor.role === 'admin' || actor.role === 'manager' || actor.role === 'sales';
}

async function assertEnrollmentAccess(
  campaignId: string,
  leadId: string,
  actor: Actor,
): Promise<void> {
  if (!canMutateEnrollment(actor)) {
    throw new AppError('Forbidden: insufficient permissions', 403);
  }
  if (actor.role === 'sales') {
    const lead = await getLeadByIdService(leadId, toLeadActor(actor));
    assertAccess(lead.assigned_to, toLeadActor(actor), true);
  }
  void campaignId;
}

async function senderReadiness(steps: SequenceStep[]): Promise<Map<string, boolean>> {
  const readiness = new Map<string, boolean>();
  const channels = [...new Set(steps.map((s) => s.channel))].filter((c) => c !== 'phone_call');
  const namesFor = (channel: string): string[] => {
    if (channel === 'whatsapp') return ['whatsapp'];
    if (channel === 'sms') return ['twilio'];
    if (channel === 'email') return ['sendgrid', 'smtp'];
    return [];
  };
  for (const channel of channels) {
    const names = namesFor(channel);
    if (names.length === 0) {
      readiness.set(channel, true);
      continue;
    }
    const integrations = await Promise.all(names.map((name) => findIntegrationByName(name)));
    readiness.set(
      channel,
      integrations.some((i) => i?.is_enabled && i.last_test_status === 'ok'),
    );
  }
  return readiness;
}

async function liveSteps(campaign: Campaign): Promise<SequenceStep[]> {
  if (!campaign.sequence_id) return [];
  const sequence = await findSequenceById(campaign.sequence_id).catch(() => null);
  if (!sequence || !Array.isArray(sequence.steps)) return [];
  return sequence.steps;
}

function waitingReasonForRow(input: {
  campaign: Campaign;
  row: EnrollmentOperationsRow;
  steps: SequenceStep[];
  sentToday: number | null;
  senderReady: Map<string, boolean>;
  now: Date;
}): { reason: WaitingReason | null; detail: string | null } {
  const row = input.row;
  const terminal = row.enrollment_status === 'completed' || row.enrollment_status === 'stopped';
  if (terminal) return { reason: null, detail: null };
  if (input.campaign.status === 'paused')
    return { reason: 'campaign_paused', detail: 'Campaign is paused.' };
  if (row.enrollment_status === 'paused') {
    return { reason: 'enrollment_paused', detail: row.pause_reason ?? 'Enrollment is paused.' };
  }
  if (row.timing_unknown) {
    return {
      reason: 'scheduling_unavailable',
      detail: 'Timing was lost — resume with an explicit schedule.',
    };
  }
  const nextStep = input.steps.find((s) => s.stepNumber === row.next_step_number);
  const nextChannel = row.snapshot_next_channel ?? nextStep?.channel ?? null;
  const hasCommitted = row.next_due_at != null && row.next_step_number != null;
  if (nextChannel === 'phone_call' && Number(row.open_task_count) > 0) {
    return { reason: 'manual_task_pending', detail: 'Waiting on the phone-call task.' };
  }
  if (nextChannel && nextChannel !== 'phone_call' && input.senderReady.get(nextChannel) === false) {
    return { reason: 'sender_unavailable', detail: `No ready sender for ${nextChannel}.` };
  }
  if (hasCommitted && row.next_due_at) {
    const remaining = new Date(row.next_due_at).getTime() - input.now.getTime();
    const deferral = computeDispatchDeferralMs(input.campaign, input.sentToday, input.now);
    const reason = describeWaitingReason({
      campaignStatus: input.campaign.status,
      enrollmentPaused: false,
      hasCommittedNextStep: true,
      nextStepChannel: nextChannel,
      nextStepIsManualTask: nextChannel === 'phone_call',
      deferralReason: remaining > 60_000 ? null : deferral.reason,
      sequenceDelayRemainingMs: Math.max(remaining, 0),
      senderReady: true,
    });
    if (reason === 'sequence_delay') {
      return {
        reason,
        detail: `Next step due ${formatDueInTimezone(row.next_due_at, input.campaign.send_window_timezone)}.`,
      };
    }
    if (reason) return { reason, detail: null };
  }
  return { reason: null, detail: null };
}

export async function getCampaignOperations(
  campaignId: string,
  _actor: Actor,
): Promise<OperationsOverview> {
  const campaign = await loadCampaign(campaignId);
  const now = new Date();
  const timezone = campaign.send_window_timezone || 'UTC';
  const durable = isCampaignOperationsV2Enabled();

  const [next, attention, byState, stats] = await Promise.all([
    findNextCommittedActivity(campaignId).catch(() => null),
    countAttentionItems(campaignId).catch(() => ({ failed: '0', uncertain: '0', scheduled: '0' })),
    countExecutionsByState(campaignId).catch(() => []),
    getCampaignStats(campaignId),
  ]);
  const sentToday =
    campaign.daily_send_limit != null
      ? await countSentTodayForCampaign(campaignId, timezone).catch(() => 0)
      : await countSentTodayForCampaign(campaignId, timezone).catch(() => 0);

  let nextActivity: OperationsNextActivity | null = null;
  if (next?.due_at && next.lead_id && next.step_number != null && next.channel) {
    let businessName: string | null = null;
    try {
      const lead = await getLeadByIdService(next.lead_id, {
        id: _actor.id,
        role: _actor.role as 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer',
      });
      businessName = lead.business_name ?? null;
    } catch {
      businessName = null;
    }
    nextActivity = {
      kind: 'committed',
      leadId: next.lead_id,
      businessName,
      stepNumber: next.step_number,
      channel: next.channel,
      dueAt: next.due_at,
      dueLabel: formatDueInTimezone(next.due_at, timezone),
    };
  }

  const steps = await liveSteps(campaign);
  const liveTotal = steps.length > 0 ? steps.length : null;
  // Campaign-wide totals aggregate EVERY enrollment in one bounded query —
  // never the first page of a paginated list. Each enrollment contributes
  // its pinned snapshot's step count (legacy rows fall back to the live
  // sequence length).
  const allRows = await listAllEnrollmentStates(campaignId).catch(() => []);
  const senderReady = await senderReadiness(steps).catch(() => new Map());
  const reasonCounts = new Map<WaitingReason, number>();
  let potentialRemaining = 0;
  let unknownTiming = 0;
  for (const row of allRows) {
    const terminal = row.enrollment_status === 'completed' || row.enrollment_status === 'stopped';
    const rowTotal =
      row.snapshot_total_steps != null ? parseInt(row.snapshot_total_steps, 10) : liveTotal;
    potentialRemaining += computePotentialRemaining({
      totalSteps: rowTotal ?? 0,
      completedSteps: row.completed_steps,
      terminal: terminal || row.lead_status !== 'active',
    });
    if (row.timing_unknown && !terminal) unknownTiming += 1;
    const { reason } = waitingReasonForRow({
      campaign,
      row,
      steps,
      sentToday,
      senderReady,
      now,
    });
    if (reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  const attentionItems: OperationsOverview['attention'] = [];
  const failed = parseInt(attention.failed, 10);
  const uncertain = parseInt(attention.uncertain, 10);
  if (failed > 0)
    attentionItems.push({ kind: 'failed', count: failed, label: 'Failed sends need review' });
  if (uncertain > 0) {
    attentionItems.push({
      kind: 'uncertain',
      count: uncertain,
      label: 'Uncertain deliveries need review',
    });
  }
  if (unknownTiming > 0) {
    attentionItems.push({
      kind: 'unknown_timing',
      count: unknownTiming,
      label: 'Enrollments with unknown timing need an explicit resume schedule',
    });
  }

  return {
    campaignId,
    status: campaign.status,
    timezone,
    durable,
    nextActivity,
    scheduledCount: parseInt(attention.scheduled, 10),
    potentialRemaining,
    sentToday,
    dailyLimit: campaign.daily_send_limit,
    capacityRemaining:
      campaign.daily_send_limit != null ? Math.max(campaign.daily_send_limit - sentToday, 0) : null,
    attempts: stats.sent + stats.failed,
    failedUnresolved: failed,
    uncertain,
    executionsByState: byState.map((r) => ({
      state: r.state,
      channel: r.channel,
      count: parseInt(r.count, 10),
    })),
    waitingReasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })),
    attention: attentionItems,
    computedAt: now.toISOString(),
  };
}

export async function getCampaignSchedule(
  campaignId: string,
  _actor: Actor,
  input: { limit: number; includeProjected?: boolean },
): Promise<{
  committed: ScheduleCommittedItem[];
  projected: ScheduleProjectedItem[];
  meta: { limit: number };
}> {
  const campaign = await loadCampaign(campaignId);
  const timezone = campaign.send_window_timezone || 'UTC';
  const committedRows = await findCommittedSchedule(campaignId, input.limit).catch(() => []);
  const leadIds = [...new Set(committedRows.map((r) => r.lead_id))];
  const names = new Map<string, string | null>();
  await Promise.all(
    leadIds.slice(0, 50).map(async (leadId) => {
      try {
        const lead = await getLeadByIdService(leadId, {
          id: _actor.id,
          role: _actor.role as 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer',
        });
        names.set(leadId, lead.business_name ?? null);
      } catch {
        names.set(leadId, null);
      }
    }),
  );
  const committed: ScheduleCommittedItem[] = committedRows.map((row) => ({
    leadId: row.lead_id,
    businessName: names.get(row.lead_id) ?? null,
    stepNumber: row.step_number,
    channel: row.channel,
    state: row.state,
    dueAt: row.due_at,
    dueLabel: row.due_at ? formatDueInTimezone(row.due_at, timezone) : null,
  }));

  const projected: ScheduleProjectedItem[] = [];
  if (input.includeProjected !== false) {
    const steps = await liveSteps(campaign);
    const { rows } = await findEnrollmentsPage(campaignId, { limit: 100 }).catch(() => ({
      rows: [],
      hasMore: false,
    }));
    const anchor = new Date();
    for (const row of rows.slice(0, 25)) {
      if (row.enrollment_status !== 'active' || row.next_step_number == null) continue;
      const upcoming = steps.filter((s) => s.stepNumber > (row.next_step_number ?? 0)).slice(0, 3);
      let cursor = row.next_due_at ? new Date(row.next_due_at).getTime() : anchor.getTime();
      for (const step of upcoming) {
        cursor += (step.delayHours ?? 24) * 3_600_000;
        const estimated = new Date(cursor).toISOString();
        projected.push({
          leadId: row.lead_id,
          stepNumber: step.stepNumber,
          channel: step.channel,
          estimatedDueAt: estimated,
          estimatedDueLabel: formatDueInTimezone(estimated, timezone),
        });
      }
      if (projected.length >= 100) break;
    }
  }

  return { committed, projected, meta: { limit: input.limit } };
}

export async function getCampaignActivity(
  campaignId: string,
  _actor: Actor,
  input: { limit: number; cursor?: string },
): Promise<{
  items: Array<{
    id: string;
    kind: string;
    leadId: string | null;
    stepNumber: number | null;
    channel: string | null;
    status: string | null;
    createdAt: string;
  }>;
  meta: { hasMore: boolean; nextCursor: string | null };
}> {
  await loadCampaign(campaignId);
  const decoded = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !decoded) throw new AppError('Invalid cursor', 400);
  const { rows, hasMore } = await findCampaignActivity(
    campaignId,
    input.limit,
    decoded?.ts,
    decoded?.id,
  );
  const last = rows[rows.length - 1];
  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      leadId: row.lead_id,
      stepNumber: row.step_number,
      channel: row.channel,
      status: row.status,
      createdAt: row.created_at,
    })),
    meta: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ ts: last.created_at, id: last.id }) : null,
    },
  };
}

export async function getCampaignEnrollments(
  campaignId: string,
  actor: Actor,
  input: {
    limit: number;
    cursor?: string;
    enrollmentStatus?: 'active' | 'paused' | 'completed' | 'stopped';
    search?: string;
  },
): Promise<{
  items: EnrollmentProgressItem[];
  meta: { hasMore: boolean; nextCursor: string | null };
}> {
  const campaign = await loadCampaign(campaignId);
  const now = new Date();
  const timezone = campaign.send_window_timezone || 'UTC';
  const decoded = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !decoded) throw new AppError('Invalid cursor', 400);

  const steps = await liveSteps(campaign);
  const sentToday = await countSentTodayForCampaign(campaignId, timezone).catch(() => 0);
  const senderReady = await senderReadiness(steps).catch(() => new Map());
  const { rows, hasMore } = await findEnrollmentsPage(campaignId, {
    limit: input.limit,
    cursorAddedAt: decoded?.ts,
    cursorLeadId: decoded?.id,
    enrollmentStatus: input.enrollmentStatus,
    search: input.search,
  });

  const items: EnrollmentProgressItem[] = rows.map((row) => {
    const terminal = row.enrollment_status === 'completed' || row.enrollment_status === 'stopped';
    const liveNext = steps.find((s) => s.stepNumber === row.next_step_number) ?? null;
    const nextChannel = row.snapshot_next_channel ?? liveNext?.channel ?? null;
    const rowTotal =
      row.snapshot_total_steps != null
        ? parseInt(row.snapshot_total_steps, 10)
        : steps.length > 0
          ? steps.length
          : null;
    const { reason, detail } = waitingReasonForRow({
      campaign,
      row,
      steps,
      sentToday,
      senderReady,
      now,
    });
    const terminalReason = terminal
      ? (row.stop_reason ?? row.enrollment_status)
      : row.lead_status !== 'active'
        ? `Lead ${row.lead_status}`
        : null;
    const mutable = canMutateEnrollment(actor);
    return {
      leadId: row.lead_id,
      businessName: row.business_name,
      contactName: row.contact_name,
      leadStatus: row.lead_status,
      enrollmentStatus: row.enrollment_status,
      completedSteps: row.completed_steps,
      totalSteps: rowTotal,
      nextAction:
        !terminal && row.next_step_number != null && nextChannel
          ? {
              kind: row.next_due_at ? 'committed' : 'projected',
              stepNumber: row.next_step_number,
              channel: nextChannel,
              dueAt: row.next_due_at,
              dueLabel: row.next_due_at ? formatDueInTimezone(row.next_due_at, timezone) : null,
            }
          : null,
      waitingReason: reason,
      waitingDetail: detail,
      terminalReason,
      lastActivity: row.latest_time
        ? { at: row.latest_time, status: row.latest_status ?? 'unknown' }
        : null,
      openTasks: parseInt(row.open_task_count ?? '0', 10),
      schedulingGeneration: row.scheduling_generation,
      timingUnknown: row.timing_unknown,
      actions: {
        pause: mutable && row.enrollment_status === 'active' && campaign.status !== 'archived',
        resume: mutable && row.enrollment_status === 'paused',
        retry:
          mutable &&
          row.latest_status === 'failed' &&
          campaign.status === 'active' &&
          row.enrollment_status === 'active',
        reschedule: mutable && row.enrollment_status === 'paused',
      },
    };
  });

  const last = rows[rows.length - 1];
  return {
    items,
    meta: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ ts: last.added_at, id: last.lead_id }) : null,
    },
  };
}

export async function pauseCampaignEnrollment(
  campaignId: string,
  leadId: string,
  actor: Actor,
  input: { reason?: string; expectedGeneration: number },
): Promise<EnrollmentProgressItem['enrollmentStatus']> {
  await loadCampaign(campaignId);
  await assertEnrollmentAccess(campaignId, leadId, actor);
  const row = await pauseEnrollmentState(
    campaignId,
    leadId,
    input.reason ?? null,
    input.expectedGeneration,
    new Date().toISOString(),
  ).catch(() => null);
  if (!row) {
    const current = await getEnrollmentState(campaignId, leadId).catch(() => null);
    if (!current) throw new AppError('Enrollment not found', 404);
    if (current.enrollment_status !== 'active') {
      throw new AppError(
        `Enrollment is ${current.enrollment_status} — only active enrollments can be paused.`,
        409,
      );
    }
    throw new AppError('Enrollment changed — reload and retry with the latest version.', 409);
  }
  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.enrollment_paused',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { leadId, reason: input.reason ?? null },
    ipAddress: actor.ipAddress ?? null,
  });
  return row.enrollment_status;
}

export async function resumeCampaignEnrollment(
  campaignId: string,
  leadId: string,
  actor: Actor,
  input: { expectedGeneration: number; nextDueAt?: string },
): Promise<{ status: string; nextDueAt: string | null }> {
  const campaign = await loadCampaign(campaignId);
  await assertEnrollmentAccess(campaignId, leadId, actor);
  const current = await getEnrollmentState(campaignId, leadId).catch(() => null);
  if (!current) throw new AppError('Enrollment not found', 404);
  if (current.scheduling_generation !== input.expectedGeneration) {
    throw new AppError('Enrollment changed — reload and retry with the latest version.', 409);
  }
  if (campaign.status === 'paused' && !input.nextDueAt) {
    logger.info(
      'enrollment resumed while campaign paused — stays unscheduled until campaign resumes',
      {
        campaignId,
        leadId,
      },
    );
  }
  // State transition, restored timing, and current-generation execution
  // commit atomically inside resumeSingleEnrollment; transport publication
  // follows the commit. Campaign-level resume never touches this row.
  const sequenceId = campaign.sequence_id ?? undefined;
  const result = await resumeSingleEnrollment({
    campaign,
    enrollment: current,
    explicitDueAt: input.nextDueAt,
    sequenceId,
  });
  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.enrollment_resumed',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { leadId, nextDueAt: result.nextDueAt },
    ipAddress: actor.ipAddress ?? null,
  });
  return { status: result.status, nextDueAt: result.nextDueAt };
}

/**
 * Bulk operational summary for the campaign list — one bounded query keyed
 * by the requested ids. Unknown ids are omitted, never error.
 */
export async function getCampaignsSummary(
  campaignIds: string[],
  _actor: Actor,
): Promise<
  Array<{
    campaignId: string;
    scheduled: number;
    failed: number;
    uncertain: number;
    nextDueAt: string | null;
  }>
> {
  const ids = [...new Set(campaignIds)].slice(0, 100);
  if (ids.length === 0) return [];
  const rows = await summarizeCampaigns(ids).catch(() => []);
  return rows.map((row) => ({
    campaignId: row.campaign_id,
    scheduled: parseInt(row.scheduled ?? '0', 10),
    failed: parseInt(row.failed ?? '0', 10),
    uncertain: parseInt(row.uncertain ?? '0', 10),
    nextDueAt: row.next_due_at,
  }));
}
