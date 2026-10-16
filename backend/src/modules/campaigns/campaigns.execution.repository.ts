/**
 * Durable campaign execution repository.
 *
 * Owns every new scheduling table from migration 0085
 * (`campaign_sequence_snapshots`, `campaign_step_executions`,
 * `campaign_day_capacity`) plus the execution columns on `campaign_leads`
 * (including the `mock_mode` corrections from migration 0086).
 * Services make scheduling decisions; this module only runs parameterized
 * database operations. Requires migrations 0085+0086 — callers must gate the
 * durable path behind `isCampaignOperationsV2Enabled()`.
 *
 * Concurrency protocol (pause vs. claim): both transitions lock the same
 * rows in the same order — campaigns row first, then the campaign_leads
 * enrollment row. Claims additionally lock their execution row first (a row
 * pause never touches), so the shared-resource order stays deadlock-free:
 * execution → campaign → enrollment for claims, campaign → enrollment for
 * pause. Every claim revalidates live campaign status, enrollment status,
 * and generation inside the lock; anything committed by pause first is
 * therefore unclaimable afterwards, while claims committed first remain
 * valid in-flight sends.
 */
import { isDeepStrictEqual } from 'node:util';
import type { WaitingReason } from './campaigns.scheduling';
import { pool, withTransaction } from '../../shared/utils/db';
import type { SequenceStep } from '../outreach/outreach.types';
import type { Campaign } from './campaigns.types';

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'stopped';
export type StepExecutionState =
  | 'unscheduled'
  | 'scheduled'
  | 'claimed'
  | 'sent'
  | 'failed'
  | 'uncertain'
  | 'skipped';

export interface SequenceSnapshotRow {
  id: string;
  campaign_id: string;
  sequence_id: string;
  version: number;
  steps: SequenceStep[];
  created_at: string;
}

export interface EnrollmentStateRow {
  campaign_id: string;
  lead_id: string;
  enrollment_status: EnrollmentStatus;
  sequence_snapshot_id: string | null;
  next_step_number: number | null;
  next_due_at: string | null;
  delay_remaining_ms: string | null;
  completed_steps: number;
  pause_reason: string | null;
  stop_reason: string | null;
  scheduling_generation: number;
  timing_unknown: boolean;
  /** Immutable dispatch mode for the enrollment (simulated vs. real sends). */
  mock_mode: boolean;
  execution_updated_at: string;
}

export interface StepExecutionRow {
  id: string;
  campaign_id: string;
  lead_id: string;
  snapshot_id: string | null;
  step_number: number;
  channel: string;
  template_id: string | null;
  generation: number;
  dedupe_key: string;
  state: StepExecutionState;
  attempts: number;
  due_at: string | null;
  transport_job_id: string | null;
  provider_msg_id: string | null;
  lease_expires_at: string | null;
  claimed_by: string | null;
  error_category: string | null;
  error_message: string | null;
  manual_override: boolean;
  override_provenance: string | null;
  /** Immutable dispatch mode: simulated work must stay simulated. */
  mock_mode: boolean;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Opaque stable execution identity. Never includes emails or message bodies. */
export function buildDedupeKey(input: {
  campaignId: string;
  leadId: string;
  snapshotId: string | null;
  stepNumber: number;
  generation: number;
  attempt: number;
}): string {
  return [
    'cmp',
    input.campaignId,
    input.leadId,
    input.snapshotId ?? 'legacy',
    `s${input.stepNumber}`,
    `g${input.generation}`,
    `a${input.attempt}`,
  ].join(':');
}

/**
 * Reuse the latest snapshot when the step definitions are unchanged;
 * otherwise mint a new immutable version. Existing enrollments keep the
 * snapshot id already stored on their row.
 */
export async function ensureSequenceSnapshot(
  campaignId: string,
  sequenceId: string,
  steps: SequenceStep[],
): Promise<SequenceSnapshotRow> {
  const normalized = JSON.stringify(steps);
  // A conflicting version was allocated by another caller. Re-read and reuse
  // its immutable snapshot when equivalent; otherwise allocate the next version.
  for (;;) {
    const latest = await pool.query<SequenceSnapshotRow>(
      `SELECT * FROM campaign_sequence_snapshots
        WHERE campaign_id = $1 ORDER BY version DESC LIMIT 1`,
      [campaignId],
    );
    const current = latest.rows[0];
    if (current && current.sequence_id === sequenceId && isDeepStrictEqual(current.steps, steps)) {
      return current;
    }
    const created = await pool.query<SequenceSnapshotRow>(
      `INSERT INTO campaign_sequence_snapshots (campaign_id, sequence_id, version, steps)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (campaign_id, version) DO NOTHING RETURNING *`,
      [campaignId, sequenceId, current ? current.version + 1 : 1, normalized],
    );
    if (created.rows[0]) return created.rows[0];
  }
}

export async function findLatestSnapshot(campaignId: string): Promise<SequenceSnapshotRow | null> {
  const result = await pool.query<SequenceSnapshotRow>(
    `SELECT * FROM campaign_sequence_snapshots
      WHERE campaign_id = $1
      ORDER BY version DESC
      LIMIT 1`,
    [campaignId],
  );
  return result.rows[0] ?? null;
}

export async function findSnapshotById(id: string): Promise<SequenceSnapshotRow | null> {
  const result = await pool.query<SequenceSnapshotRow>(
    `SELECT * FROM campaign_sequence_snapshots WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function upsertEnrollmentState(
  campaignId: string,
  leadId: string,
  fields: Partial<{
    enrollmentStatus: EnrollmentStatus;
    sequenceSnapshotId: string | null;
    nextStepNumber: number | null;
    nextDueAt: string | null;
    delayRemainingMs: number | null;
    completedSteps: number;
    pauseReason: string | null;
    stopReason: string | null;
    timingUnknown: boolean;
    mockMode: boolean;
  }>,
): Promise<EnrollmentStateRow> {
  const result = await pool.query<EnrollmentStateRow>(
    `INSERT INTO campaign_leads
      (campaign_id, lead_id, enrollment_status, sequence_snapshot_id, next_step_number,
       next_due_at, delay_remaining_ms, completed_steps, pause_reason, stop_reason, timing_unknown,
       mock_mode)
     VALUES ($1, $2,
       COALESCE($3, 'active'), $4, $5, $6::timestamptz, $7, COALESCE($8, 0), $9, $10,
       COALESCE($11, false), COALESCE($12, false))
    ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
      enrollment_status = COALESCE($3, campaign_leads.enrollment_status),
      sequence_snapshot_id = COALESCE($4, campaign_leads.sequence_snapshot_id),
      next_step_number = COALESCE($5, campaign_leads.next_step_number),
      next_due_at = COALESCE($6::timestamptz, campaign_leads.next_due_at),
      delay_remaining_ms = COALESCE($7, campaign_leads.delay_remaining_ms),
      completed_steps = COALESCE($8, campaign_leads.completed_steps),
      pause_reason = COALESCE($9, campaign_leads.pause_reason),
      stop_reason = COALESCE($10, campaign_leads.stop_reason),
      timing_unknown = COALESCE($11, campaign_leads.timing_unknown),
      mock_mode = COALESCE($12, campaign_leads.mock_mode),
      execution_updated_at = NOW()
    RETURNING campaign_id, lead_id, enrollment_status, sequence_snapshot_id,
      next_step_number, next_due_at, delay_remaining_ms, completed_steps,
      pause_reason, stop_reason, scheduling_generation, timing_unknown, mock_mode, execution_updated_at`,
    [
      campaignId,
      leadId,
      fields.enrollmentStatus ?? null,
      fields.sequenceSnapshotId ?? null,
      fields.nextStepNumber ?? null,
      fields.nextDueAt ?? null,
      fields.delayRemainingMs ?? null,
      fields.completedSteps ?? null,
      fields.pauseReason ?? null,
      fields.stopReason ?? null,
      fields.timingUnknown ?? null,
      fields.mockMode ?? null,
    ],
  );
  return result.rows[0];
}

export async function getEnrollmentState(
  campaignId: string,
  leadId: string,
): Promise<EnrollmentStateRow | null> {
  const result = await pool.query<EnrollmentStateRow>(
    `SELECT campaign_id, lead_id, enrollment_status, sequence_snapshot_id,
       next_step_number, next_due_at, delay_remaining_ms, completed_steps,
       pause_reason, stop_reason, scheduling_generation, timing_unknown, mock_mode, execution_updated_at
     FROM campaign_leads
     WHERE campaign_id = $1 AND lead_id = $2`,
    [campaignId, leadId],
  );
  return result.rows[0] ?? null;
}

/** Identify durable enrollments safely before querying additive execution columns. */
export async function hasDurableEnrollment(campaignId: string, leadId: string): Promise<boolean> {
  const result = await pool.query<{ durable: boolean }>(
    `SELECT COALESCE(to_jsonb(cl)->>'sequence_snapshot_id', '') <> '' AS durable
       FROM campaign_leads cl
      WHERE campaign_id = $1 AND lead_id = $2`,
    [campaignId, leadId],
  );
  return result.rows[0]?.durable ?? false;
}

export async function hasDurableEnrollments(campaignId: string): Promise<boolean> {
  const result = await pool.query<{ durable: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM campaign_leads cl
        WHERE campaign_id = $1
          AND COALESCE(to_jsonb(cl)->>'sequence_snapshot_id', '') <> ''
     ) AS durable`,
    [campaignId],
  );
  return result.rows[0]?.durable ?? false;
}

/**
 * Pause a campaign and freeze every pending enrollment delay in one
 * transaction. The campaigns row is locked first, then the enrollment rows
 * — the same order claims use — so a claim can never slip between the
 * status flip and the freeze. Returns null when the campaign is not active
 * (caller reports the conflict); no partial state is committed.
 */
export async function pauseCampaignTx(
  campaignId: string,
  pausedAtIso: string,
): Promise<{ campaign: Campaign; frozen: number } | null> {
  return withTransaction(async (client) => {
    const flipped = await client.query<Campaign>(
      `UPDATE campaigns SET status = 'paused'
        WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
        RETURNING *`,
      [campaignId],
    );
    const campaign = flipped.rows[0];
    if (!campaign) return null;
    const frozen = await client.query<{ id: string }>(
      `UPDATE campaign_leads
          SET delay_remaining_ms = CASE
                WHEN next_due_at IS NOT NULL THEN GREATEST(
                  0,
                  EXTRACT(EPOCH FROM (next_due_at - $2::timestamptz)) * 1000
                )::bigint
                ELSE delay_remaining_ms
              END,
              next_due_at = NULL,
              scheduling_generation = scheduling_generation + 1,
              execution_updated_at = NOW()
        WHERE campaign_id = $1 AND enrollment_status = 'active'
        RETURNING id`,
      [campaignId, pausedAtIso],
    );
    return { campaign, frozen: frozen.rows.length };
  });
}

export async function insertStepExecution(input: {
  campaignId: string;
  leadId: string;
  snapshotId: string | null;
  stepNumber: number;
  channel: string;
  templateId: string | null;
  generation: number;
  attempt: number;
  dueAt: string | null;
  /** Immutable dispatch mode — simulated work must stay simulated. */
  mockMode: boolean;
  manualOverride?: boolean;
  overrideProvenance?: string | null;
}): Promise<StepExecutionRow | null> {
  const dedupeKey = buildDedupeKey({
    campaignId: input.campaignId,
    leadId: input.leadId,
    snapshotId: input.snapshotId,
    stepNumber: input.stepNumber,
    generation: input.generation,
    attempt: input.attempt,
  });
  const result = await pool.query<StepExecutionRow>(
    `INSERT INTO campaign_step_executions
      (campaign_id, lead_id, snapshot_id, step_number, channel, template_id,
       generation, dedupe_key, state, due_at, mock_mode, manual_override, override_provenance, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unscheduled', $9::timestamptz, $10, $11, $12, $13)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [
      input.campaignId,
      input.leadId,
      input.snapshotId,
      input.stepNumber,
      input.channel,
      input.templateId,
      input.generation,
      dedupeKey,
      input.dueAt,
      input.mockMode,
      input.manualOverride ?? false,
      input.overrideProvenance ?? null,
      input.attempt,
    ],
  );
  return result.rows[0] ?? null;
}

/** Most recent execution for a step — used to inherit dispatch mode and attempt numbering on retry. */
export async function findLatestStepExecution(
  campaignId: string,
  leadId: string,
  stepNumber: number,
  generation?: number,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE campaign_id = $1 AND lead_id = $2 AND step_number = $3
        ${generation !== undefined ? 'AND generation = $4' : ''}
      ORDER BY substring(dedupe_key from ':a([0-9]+)$')::integer DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    generation !== undefined
      ? [campaignId, leadId, stepNumber, generation]
      : [campaignId, leadId, stepNumber],
  );
  return result.rows[0] ?? null;
}

export async function findPendingExecution(
  campaignId: string,
  leadId: string,
  stepNumber: number,
  generation: number,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE campaign_id = $1 AND lead_id = $2 AND step_number = $3 AND generation = $4
        AND state IN ('unscheduled', 'scheduled', 'claimed')
      ORDER BY substring(dedupe_key from ':a([0-9]+)$')::integer DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [campaignId, leadId, stepNumber, generation],
  );
  return result.rows[0] ?? null;
}

export async function markExecutionTransportScheduled(
  dedupeKey: string,
  transportJobId: string,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `UPDATE campaign_step_executions
        SET state = 'scheduled',
            transport_job_id = $2,
            updated_at = NOW()
      WHERE dedupe_key = $1 AND state IN ('unscheduled', 'scheduled')
      RETURNING *`,
    [dedupeKey, transportJobId],
  );
  return result.rows[0] ?? null;
}

/**
 * Transactionally claim a due execution for dispatch while holding the
 * locks shared with pause transitions (execution row, then campaigns row,
 * then enrollment row). The claim revalidates live campaign status,
 * enrollment status, and generation inside the lock: anything a committed
 * pause changed is unclaimable afterwards, while claims committed first
 * stay valid in-flight sends. Stale generations, terminal rows, paused
 * campaigns/enrollments, and already-claimed leases return null — the
 * worker must exit without sending.
 */
export async function claimDueStepExecutionTx(input: {
  dedupeKey: string;
  expectedGeneration: number;
  workerId: string;
  leaseMs: number;
}): Promise<StepExecutionRow | null> {
  return withTransaction(async (client) => {
    const now = Date.now();
    const found = await client.query<StepExecutionRow>(
      `SELECT * FROM campaign_step_executions WHERE dedupe_key = $1 FOR UPDATE`,
      [input.dedupeKey],
    );
    const execution = found.rows[0];
    if (!execution) return null;
    if (execution.generation !== input.expectedGeneration) return null;
    if (execution.state !== 'scheduled' && execution.state !== 'unscheduled') return null;
    if (execution.due_at && new Date(execution.due_at).getTime() > now) return null;
    if (execution.lease_expires_at && new Date(execution.lease_expires_at).getTime() > now) {
      return null;
    }
    const campaign = await client.query<{ status: string }>(
      `SELECT status FROM campaigns WHERE id = $1 FOR UPDATE`,
      [execution.campaign_id],
    );
    if (!campaign.rows[0] || campaign.rows[0].status !== 'active') return null;
    const enrollment = await client.query<{
      enrollment_status: EnrollmentStatus;
      scheduling_generation: number;
    }>(
      `SELECT enrollment_status, scheduling_generation FROM campaign_leads
        WHERE campaign_id = $1 AND lead_id = $2 FOR UPDATE`,
      [execution.campaign_id, execution.lead_id],
    );
    const state = enrollment.rows[0];
    if (!state || state.enrollment_status !== 'active') return null;
    if (state.scheduling_generation !== input.expectedGeneration) return null;
    const claimed = await client.query<StepExecutionRow>(
      `UPDATE campaign_step_executions
          SET state = 'claimed',
              attempts = attempts + 1,
              claimed_by = $2,
              lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
              updated_at = NOW()
        WHERE dedupe_key = $1
        RETURNING *`,
      [input.dedupeKey, input.workerId, String(input.leaseMs)],
    );
    return claimed.rows[0] ?? null;
  });
}

export async function releaseExecutionClaim(dedupeKey: string, dueAt?: string): Promise<void> {
  await pool.query(
    `WITH released AS (
       UPDATE campaign_step_executions
          SET state = 'scheduled', lease_expires_at = NULL, claimed_by = NULL,
              due_at = COALESCE($2::timestamptz, due_at), updated_at = NOW()
        WHERE dedupe_key = $1 AND state = 'claimed'
        RETURNING campaign_id, lead_id, step_number, generation
     )
     UPDATE campaign_leads cl SET next_due_at = $2::timestamptz, execution_updated_at = NOW()
       FROM released r
      WHERE $2::timestamptz IS NOT NULL AND cl.campaign_id = r.campaign_id
        AND cl.lead_id = r.lead_id AND cl.next_step_number = r.step_number
        AND cl.scheduling_generation = r.generation AND cl.enrollment_status = 'active'
        AND cl.next_due_at IS NOT NULL`,
    [dedupeKey, dueAt ?? null],
  );
}

export async function markExecutionSent(
  dedupeKey: string,
  providerMsgId: string | null,
): Promise<StepExecutionRow | null> {
  return withTransaction(async (client) => {
    const result = await client.query<StepExecutionRow>(
      `UPDATE campaign_step_executions
          SET state = 'sent', provider_msg_id = COALESCE($2, provider_msg_id),
              lease_expires_at = NULL, sent_at = NOW(), updated_at = NOW()
        WHERE dedupe_key = $1 AND state = 'claimed' RETURNING *`,
      [dedupeKey, providerMsgId],
    );
    const execution = result.rows[0] ?? null;
    if (execution?.channel === 'phone_call') {
      await client.query('SELECT id FROM campaigns WHERE id = $1 FOR UPDATE', [
        execution.campaign_id,
      ]);
      // Task creation is not completion: keep the phone step current but remove
      // its send ETA so campaign pause cannot freeze and replay it as due work.
      await client.query(
        `UPDATE campaign_leads SET next_due_at = NULL, delay_remaining_ms = NULL,
            execution_updated_at = NOW()
          WHERE campaign_id = $1 AND lead_id = $2 AND next_step_number = $3
            AND enrollment_status IN ('active', 'paused')`,
        [execution.campaign_id, execution.lead_id, execution.step_number],
      );
    }
    return execution;
  });
}

export async function markExecutionFailed(
  dedupeKey: string,
  errorCategory: string,
  errorMessage: string,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `UPDATE campaign_step_executions
        SET state = 'failed',
            error_category = $2,
            error_message = $3,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE dedupe_key = $1 AND state = 'claimed'
      RETURNING *`,
    [dedupeKey, errorCategory, errorMessage],
  );
  return result.rows[0] ?? null;
}

/**
 * Uncertain provider outcome: the message may have been accepted. The row
 * stays out of automatic retry — a reviewed operator action must resolve it.
 * Never blindly resend a potentially accepted message.
 */
export async function markExecutionUncertain(
  dedupeKey: string,
  errorMessage: string,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `UPDATE campaign_step_executions
        SET state = 'uncertain',
            error_category = 'uncertain_delivery',
            error_message = $2,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE dedupe_key = $1 AND state = 'claimed'
      RETURNING *`,
    [dedupeKey, errorMessage],
  );
  return result.rows[0] ?? null;
}

export async function markExecutionSkipped(
  dedupeKey: string,
  reason: string,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `UPDATE campaign_step_executions
        SET state = 'skipped',
            error_category = 'skipped',
            error_message = $2,
            lease_expires_at = NULL,
            updated_at = NOW()
      WHERE dedupe_key = $1 AND state IN ('unscheduled', 'scheduled', 'claimed')
      RETURNING *`,
    [dedupeKey, reason],
  );
  return result.rows[0] ?? null;
}

/**
 * Atomically reserve one daily campaign send. Returns true when this caller
 * owns the slot; false when the campaign-local day is already at capacity.
 * Concurrent workers serialize on the row lock — capacity cannot overshoot.
 */
export async function reserveDailyCapacity(
  campaignId: string,
  localDate: string,
  sendLimit: number,
  sentToday = 0,
): Promise<boolean> {
  const result = await pool.query<{ reserved: number }>(
    `INSERT INTO campaign_day_capacity (campaign_id, local_date, send_limit, reserved)
       VALUES ($1, $2::date, $3, GREATEST($4, 0))
     ON CONFLICT (campaign_id, local_date)
       DO UPDATE SET send_limit = EXCLUDED.send_limit,
         reserved = GREATEST(campaign_day_capacity.reserved, EXCLUDED.reserved)
     RETURNING reserved`,
    [campaignId, localDate, sendLimit, sentToday],
  );
  void result;
  const claimed = await pool.query<{ ok: string }>(
    `UPDATE campaign_day_capacity
        SET reserved = reserved + 1
      WHERE campaign_id = $1
        AND local_date = $2::date
        AND reserved < send_limit
      RETURNING '1' AS ok`,
    [campaignId, localDate],
  );
  return (claimed.rows[0]?.ok ?? null) === '1';
}

/** Existing durable enrollments must not be re-created during a campaign relaunch. */
export async function findExistingEnrollmentLeadIds(
  campaignId: string,
  leadIds: string[],
): Promise<string[]> {
  if (leadIds.length === 0) return [];
  const result = await pool.query<{ lead_id: string }>(
    `SELECT lead_id
       FROM campaign_leads
      WHERE campaign_id = $1 AND lead_id = ANY($2::uuid[])`,
    [campaignId, leadIds],
  );
  return result.rows.map((row) => row.lead_id);
}

/** Complete a final phone task against its current durable enrollment state. */
export async function hasSentPhoneTaskStep(
  campaignId: string,
  leadId: string,
  stepNumber: number,
): Promise<boolean> {
  const result = await pool.query<{ awaiting: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM campaign_step_executions
      WHERE campaign_id = $1 AND lead_id = $2 AND step_number = $3
        AND channel = 'phone_call' AND state = 'sent') AS awaiting`,
    [campaignId, leadId, stepNumber],
  );
  return result.rows[0]?.awaiting ?? false;
}

export async function completeEnrollmentAfterPhoneTaskTx(input: {
  campaignId: string;
  leadId: string;
  completedStepNumber: number;
  expectedGeneration: number;
  completedSteps: number;
}): Promise<boolean> {
  const result = await pool.query(
    `UPDATE campaign_leads
        SET enrollment_status = 'completed',
            next_step_number = NULL,
            next_due_at = NULL,
            delay_remaining_ms = NULL,
            completed_steps = GREATEST(completed_steps, $5),
            stop_reason = 'sequence_completed',
            execution_updated_at = NOW()
      WHERE campaign_id = $1 AND lead_id = $2
        AND enrollment_status IN ('active', 'paused')
        AND next_step_number = $3
        AND scheduling_generation = $4`,
    [
      input.campaignId,
      input.leadId,
      input.completedStepNumber,
      input.expectedGeneration,
      input.completedSteps,
    ],
  );
  return result.rowCount === 1;
}

/** Release a reservation after a definite failure so the slot is reusable. */
export async function releaseDailyCapacity(campaignId: string, localDate: string): Promise<void> {
  await pool.query(
    `UPDATE campaign_day_capacity
        SET reserved = GREATEST(0, reserved - 1)
      WHERE campaign_id = $1 AND local_date = $2::date`,
    [campaignId, localDate],
  );
}

/** Durable intents that never reached the transport — republish candidates. */
export async function findUnscheduledDueExecutions(limit: number): Promise<StepExecutionRow[]> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE state = 'unscheduled'
        AND (due_at IS NULL OR due_at <= NOW() + INTERVAL '5 minutes')
      ORDER BY due_at ASC NULLS FIRST, created_at ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/** Claims whose worker died before recording an outcome — reconcile, never blindly resend. */
export async function findExpiredLeaseExecutions(limit: number): Promise<StepExecutionRow[]> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE state = 'claimed'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= NOW()
      ORDER BY lease_expires_at ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export interface EnrollmentOperationsRow extends EnrollmentStateRow {
  contact_name: string | null;
  business_name: string | null;
  lead_status: string;
  latest_step: number | null;
  latest_status: string | null;
  latest_time: string | null;
  latest_error: string | null;
  open_task_count: string;
  added_at: string;
  /** Pinned step count from the enrollment's own snapshot; null when legacy. */
  snapshot_total_steps: string | null;
  /** Pinned channel for the enrollment's next step; null when legacy. */
  snapshot_next_channel: string | null;
}

export interface EnrollmentsPageFilters {
  limit: number;
  cursorAddedAt?: string;
  cursorLeadId?: string;
  enrollmentStatus?: EnrollmentStatus;
  search?: string;
}

/**
 * Server-paginated enrollment progress. Keyset cursor on
 * (added_at, lead_id) keeps pages stable as sends land. One bounded query —
 * the list page must not fan out per campaign or per lead.
 */
export async function findEnrollmentsPage(
  campaignId: string,
  filters: EnrollmentsPageFilters,
): Promise<{ rows: EnrollmentOperationsRow[]; hasMore: boolean }> {
  const conditions = ['cl.campaign_id = $1'];
  const params: unknown[] = [campaignId];
  let i = 1;
  const push = (value: unknown): string => {
    i += 1;
    params.push(value);
    return `$${i}`;
  };

  if (filters.enrollmentStatus) {
    conditions.push(`cl.enrollment_status = ${push(filters.enrollmentStatus)}`);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const p = push(pattern);
    conditions.push(
      `(l.business_name ILIKE ${p} OR l.contact_name ILIKE ${p} OR l.email ILIKE ${p})`,
    );
  }
  if (filters.cursorAddedAt && filters.cursorLeadId) {
    const ts = push(filters.cursorAddedAt);
    const id = push(filters.cursorLeadId);
    conditions.push(`(cl.added_at, cl.lead_id) < (${ts}::timestamptz, ${id}::uuid)`);
  }
  const where = conditions.join(' AND ');
  const fetchLimit = filters.limit + 1;

  const result = await pool.query<EnrollmentOperationsRow & { added_at: string }>(
    `SELECT cl.campaign_id, cl.lead_id, cl.enrollment_status, cl.sequence_snapshot_id,
       cl.next_step_number, cl.next_due_at, cl.delay_remaining_ms, cl.completed_steps,
       cl.pause_reason, cl.stop_reason, cl.scheduling_generation, cl.timing_unknown,
       cl.mock_mode,
       cl.execution_updated_at, cl.added_at,
       COALESCE(jsonb_array_length(ss.steps), NULL)::text AS snapshot_total_steps,
       (SELECT step->>'channel' FROM jsonb_array_elements(ss.steps) AS step
         WHERE (step->>'stepNumber')::int = cl.next_step_number
         LIMIT 1) AS snapshot_next_channel,
       l.contact_name, l.business_name, l.status AS lead_status,
       ol.step_number AS latest_step, ol.status AS latest_status,
       ol.created_at AS latest_time, ol.error_message AS latest_error,
       (SELECT COUNT(*)::text FROM tasks t
         WHERE t.lead_id = cl.lead_id AND t.campaign_id = cl.campaign_id
           AND t.status IN ('pending', 'in_progress')) AS open_task_count
     FROM campaign_leads cl
     JOIN leads l ON l.id = cl.lead_id
     LEFT JOIN campaign_sequence_snapshots ss ON ss.id = cl.sequence_snapshot_id
     LEFT JOIN LATERAL (
       SELECT step_number, status, created_at, error_message
       FROM outreach_logs
       WHERE lead_id = cl.lead_id AND campaign_id = cl.campaign_id
       ORDER BY created_at DESC
       LIMIT 1
     ) ol ON true
     WHERE ${where}
     ORDER BY cl.added_at DESC, cl.lead_id DESC
     LIMIT $${params.length + 1}`,
    [...params, fetchLimit],
  );
  const hasMore = result.rows.length > filters.limit;
  const rows = hasMore ? result.rows.slice(0, filters.limit) : result.rows;
  return { rows, hasMore };
}

export interface EnrollmentSummaryBucket {
  reason: WaitingReason | null;
  count: string;
  potential_remaining: string;
  unknown_timing: string;
}

/** Campaign-wide aggregates return at most one row per waiting reason. */
export async function summarizeEnrollmentStates(input: {
  campaignId: string;
  campaignPaused: boolean;
  liveSteps: SequenceStep[];
  unavailableChannels: string[];
  deferralReason: string | null;
  now: string;
}): Promise<EnrollmentSummaryBucket[]> {
  const result = await pool.query<EnrollmentSummaryBucket>(
    `WITH snapshot_shapes AS MATERIALIZED (
       SELECT ss.id, jsonb_array_length(ss.steps) AS total_steps,
         (SELECT jsonb_object_agg(step->>'stepNumber', step->>'channel')
            FROM jsonb_array_elements(ss.steps) step) AS channels
       FROM campaign_sequence_snapshots ss WHERE ss.campaign_id = $1
     ), live_shape AS (
       SELECT jsonb_array_length($3::jsonb) AS total_steps,
         (SELECT jsonb_object_agg(step->>'stepNumber', step->>'channel')
            FROM jsonb_array_elements($3::jsonb) step) AS channels
     ), open_tasks AS (
       SELECT lead_id FROM tasks WHERE campaign_id = $1
         AND status IN ('pending', 'in_progress') GROUP BY lead_id
     ), enrollment_shapes AS (
       SELECT cl.*, l.status AS lead_status,
         COALESCE(ss.total_steps, live.total_steps) AS total_steps,
         COALESCE(ss.channels->>cl.next_step_number::text,
                  live.channels->>cl.next_step_number::text) AS channel,
         t.lead_id IS NOT NULL AS has_open_task
       FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
       LEFT JOIN snapshot_shapes ss ON ss.id = cl.sequence_snapshot_id
       CROSS JOIN live_shape live
       LEFT JOIN open_tasks t ON t.lead_id = cl.lead_id
       WHERE cl.campaign_id = $1
     ), classified AS (
       SELECT *, CASE
         WHEN enrollment_status IN ('completed', 'stopped') THEN NULL
         WHEN $2::boolean THEN 'campaign_paused'
         WHEN enrollment_status = 'paused' THEN 'enrollment_paused'
         WHEN timing_unknown THEN 'scheduling_unavailable'
         WHEN channel = 'phone_call' AND has_open_task THEN 'manual_task_pending'
         WHEN channel <> 'phone_call' AND channel = ANY($4::text[]) THEN 'sender_unavailable'
         WHEN next_due_at IS NULL OR next_step_number IS NULL THEN NULL
         WHEN channel = 'phone_call' THEN 'manual_task_pending'
         WHEN next_due_at <= $6::timestamptz + INTERVAL '60 seconds' AND $5 = 'daily_cap' THEN 'daily_limit'
         WHEN next_due_at <= $6::timestamptz + INTERVAL '60 seconds' AND $5 = 'send_window' THEN 'outside_sending_hours'
         WHEN next_due_at > $6::timestamptz THEN 'sequence_delay'
         ELSE NULL END AS reason
       FROM enrollment_shapes
     )
     SELECT reason, COUNT(*)::text AS count,
       COALESCE(SUM(CASE WHEN enrollment_status IN ('active', 'paused') AND lead_status = 'active'
         THEN GREATEST(total_steps - GREATEST(completed_steps, 0), 0) ELSE 0 END), 0)::text AS potential_remaining,
       COUNT(*) FILTER (WHERE timing_unknown AND enrollment_status IN ('active', 'paused'))::text AS unknown_timing
     FROM classified GROUP BY reason`,
    [
      input.campaignId,
      input.campaignPaused,
      JSON.stringify(input.liveSteps),
      input.unavailableChannels,
      input.deferralReason,
      input.now,
    ],
  );
  return result.rows;
}

/** Committed upcoming executions for the schedule view — never projections. */
export async function findCommittedSchedule(
  campaignId: string,
  limit: number,
): Promise<StepExecutionRow[]> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE campaign_id = $1 AND state IN ('unscheduled', 'scheduled', 'claimed')
      ORDER BY due_at ASC NULLS LAST, created_at ASC
      LIMIT $2`,
    [campaignId, limit],
  );
  return result.rows;
}

/** Counts by execution state and channel for the operations overview. */
export async function countExecutionsByState(
  campaignId: string,
): Promise<Array<{ state: string; channel: string; count: string }>> {
  const result = await pool.query<{ state: string; channel: string; count: string }>(
    `SELECT state, channel, COUNT(*)::text AS count
      FROM campaign_step_executions
      WHERE campaign_id = $1
      GROUP BY state, channel`,
    [campaignId],
  );
  return result.rows;
}

export async function findExecutionByDedupeKey(
  dedupeKey: string,
): Promise<StepExecutionRow | null> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions WHERE dedupe_key = $1`,
    [dedupeKey],
  );
  return result.rows[0] ?? null;
}

/** Active enrollments with pending timing — the resume restoration set. */
export async function listActiveEnrollments(campaignId: string): Promise<EnrollmentStateRow[]> {
  const result = await pool.query<EnrollmentStateRow>(
    `SELECT campaign_id, lead_id, enrollment_status, sequence_snapshot_id,
       next_step_number, next_due_at, delay_remaining_ms, completed_steps,
       pause_reason, stop_reason, scheduling_generation, timing_unknown, mock_mode, execution_updated_at
     FROM campaign_leads
     WHERE campaign_id = $1 AND enrollment_status = 'active'
     ORDER BY next_due_at ASC NULLS LAST`,
    [campaignId],
  );
  return result.rows;
}

export interface NextActivityRow {
  due_at: string | null;
  lead_id: string | null;
  step_number: number | null;
  channel: string | null;
}

/** Earliest committed upcoming execution — the "what happens next" answer. */
export async function findNextCommittedActivity(
  campaignId: string,
): Promise<NextActivityRow | null> {
  const result = await pool.query<NextActivityRow>(
    `SELECT due_at, lead_id, step_number, channel
      FROM campaign_step_executions
      WHERE campaign_id = $1 AND state IN ('unscheduled', 'scheduled')
      ORDER BY due_at ASC NULLS LAST
      LIMIT 1`,
    [campaignId],
  );
  return result.rows[0] ?? null;
}

export interface AttentionCounts {
  failed: string;
  uncertain: string;
  scheduled: string;
}

/** Unresolved failures + uncertain outcomes needing review, per campaign. */
export async function countAttentionItems(campaignId: string): Promise<AttentionCounts> {
  const result = await pool.query<AttentionCounts>(
    `SELECT
       COUNT(*) FILTER (WHERE state = 'failed')::text AS failed,
       COUNT(*) FILTER (WHERE state = 'uncertain')::text AS uncertain,
       COUNT(*) FILTER (WHERE state IN ('unscheduled', 'scheduled'))::text AS scheduled
      FROM campaign_step_executions
      WHERE campaign_id = $1`,
    [campaignId],
  );
  return result.rows[0] ?? { failed: '0', uncertain: '0', scheduled: '0' };
}

export interface CampaignBulkSummaryRow {
  campaign_id: string;
  scheduled: string;
  failed: string;
  uncertain: string;
  next_due_at: string | null;
}

/**
 * One-row-per-campaign operational summary for the list page. A single
 * bounded query — never a request per campaign.
 */
export async function summarizeCampaigns(campaignIds: string[]): Promise<CampaignBulkSummaryRow[]> {
  if (campaignIds.length === 0) return [];
  const result = await pool.query<CampaignBulkSummaryRow>(
    `SELECT
       c.id AS campaign_id,
       COUNT(e.id) FILTER (WHERE e.state IN ('unscheduled', 'scheduled'))::text AS scheduled,
       COUNT(e.id) FILTER (WHERE e.state = 'failed')::text AS failed,
       COUNT(e.id) FILTER (WHERE e.state = 'uncertain')::text AS uncertain,
       MIN(e.due_at) FILTER (WHERE e.state IN ('unscheduled', 'scheduled')) AS next_due_at
      FROM (SELECT unnest($1::uuid[]) AS id) c
      LEFT JOIN campaign_step_executions e ON e.campaign_id = c.id
      GROUP BY c.id`,
    [campaignIds],
  );
  return result.rows;
}

export interface ActivityEntry {
  id: string;
  kind: 'send' | 'failure' | 'reply' | 'operator';
  lead_id: string | null;
  step_number: number | null;
  channel: string | null;
  status: string | null;
  body: string | null;
  created_at: string;
}

/**
 * Chronological operational history: sends, failures, replies, and operator
 * actions (pause/resume/launch/retry). Keyset cursor on (event timestamp, id, kind).
 */
export async function findCampaignActivity(
  campaignId: string,
  limit: number,
  cursorTs?: string,
  cursorId?: string,
  cursorKind?: string,
): Promise<{ rows: ActivityEntry[]; hasMore: boolean }> {
  const params: unknown[] = [campaignId];
  let i = 1;
  const push = (value: unknown): string => {
    i += 1;
    params.push(value);
    return `$${i}`;
  };
  let cursorFilter = '';
  if (cursorTs && cursorId && cursorKind) {
    cursorFilter = `WHERE (created_at, id, kind) < (${push(cursorTs)}::timestamptz, ${push(cursorId)}::uuid, ${push(cursorKind)}::text)`;
  }
  const fetchLimit = limit + 1;
  const result = await pool.query<ActivityEntry>(
    `SELECT * FROM (
       SELECT id, 'send' AS kind, lead_id, step_number, channel, status,
         error_message AS body, sent_at AS created_at
       FROM outreach_logs WHERE campaign_id = $1 AND sent_at IS NOT NULL
       UNION ALL
       SELECT id, 'failure' AS kind, lead_id, step_number, channel, status,
         error_message AS body, updated_at AS created_at
       FROM outreach_logs WHERE campaign_id = $1 AND status = 'failed'
       UNION ALL
       SELECT id, 'reply' AS kind, lead_id, step_number, channel, status,
         NULL AS body, replied_at AS created_at
       FROM outreach_logs WHERE campaign_id = $1 AND replied_at IS NOT NULL
       UNION ALL
       SELECT id, 'operator' AS kind, NULL AS lead_id, NULL AS step_number,
         NULL AS channel, action AS status, NULL AS body, created_at
       FROM audit_logs WHERE entity_type = 'campaign' AND entity_id = $1::uuid
     ) events ${cursorFilter}
     ORDER BY created_at DESC, id DESC, kind DESC
     LIMIT $${params.length + 1}`,
    [...params, fetchLimit],
  );
  const hasMore = result.rows.length > limit;
  return { rows: hasMore ? result.rows.slice(0, limit) : result.rows, hasMore };
}

/**
 * Pause one enrollment: freeze its remaining delay and bump its generation
 * so unclaimed jobs for it can never dispatch. Campaign-level resume never
 * touches rows paused here.
 */
export async function pauseEnrollmentState(
  campaignId: string,
  leadId: string,
  reason: string | null,
  expectedGeneration: number,
  pausedAtIso: string,
): Promise<EnrollmentStateRow | null> {
  const result = await pool.query<EnrollmentStateRow>(
    `UPDATE campaign_leads
        SET enrollment_status = 'paused',
            pause_reason = $3,
            delay_remaining_ms = CASE
              WHEN next_due_at IS NOT NULL THEN GREATEST(
                0,
                EXTRACT(EPOCH FROM (next_due_at - $5::timestamptz)) * 1000
              )::bigint
              ELSE delay_remaining_ms
            END,
            next_due_at = NULL,
            scheduling_generation = scheduling_generation + 1,
            execution_updated_at = NOW()
      WHERE campaign_id = $1 AND lead_id = $2
        AND enrollment_status = 'active'
        AND scheduling_generation = $4
      RETURNING campaign_id, lead_id, enrollment_status, sequence_snapshot_id,
        next_step_number, next_due_at, delay_remaining_ms, completed_steps,
        pause_reason, stop_reason, scheduling_generation, timing_unknown, mock_mode, execution_updated_at`,
    [campaignId, leadId, reason, expectedGeneration, pausedAtIso],
  );
  return result.rows[0] ?? null;
}

export interface AcceptanceNextIntent {
  stepNumber: number;
  channel: string;
  templateId: string | null;
  attempt: number;
  dueAt: string;
  delayRemainingMs: number;
}

/**
 * Atomically record provider acceptance, advance the enrollment, and persist
 * the next scheduling intent. The transport job is published only after this
 * transaction commits: a crash before commit leaves the execution claimed
 * (lease expiry converts it to an explicit uncertain outcome), while a crash
 * after commit leaves an unscheduled intent the recovery sweep republishes
 * without resending the accepted message. The next intent inherits the
 * accepted execution's dispatch mode.
 */
export async function recordAcceptanceTx(input: {
  dedupeKey: string;
  providerMsgId: string | null;
  campaignId: string;
  leadId: string;
  snapshotId: string | null;
  completedSteps: number;
  terminalStopReason: string | null;
  next: AcceptanceNextIntent | null;
}): Promise<{
  advanced: boolean;
  nextDedupeKey: string | null;
  nextGeneration: number | null;
}> {
  return withTransaction(async (client) => {
    const sent = await client.query<StepExecutionRow>(
      `UPDATE campaign_step_executions
          SET state = 'sent',
              provider_msg_id = COALESCE($2, provider_msg_id),
              lease_expires_at = NULL,
              sent_at = NOW(),
              updated_at = NOW()
        WHERE dedupe_key = $1 AND state = 'claimed'
        RETURNING *`,
      [input.dedupeKey, input.providerMsgId],
    );
    const execution = sent.rows[0];
    if (!execution) return { advanced: false, nextDedupeKey: null, nextGeneration: null };

    // Match the claim/pause lock order: execution → campaign → enrollment.
    // Pauses lock the campaign before freezing enrollment rows, so acceptance
    // either observes the committed pause and preserves frozen timing, or
    // commits first and lets the pause freeze the new follow-up normally.
    const campaign = await client.query<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = $1 FOR UPDATE',
      [input.campaignId],
    );
    const enrollmentResult = await client.query<{
      enrollment_status: EnrollmentStatus;
      next_step_number: number | null;
      scheduling_generation: number;
    }>(
      `SELECT enrollment_status, next_step_number, scheduling_generation
         FROM campaign_leads
        WHERE campaign_id = $1 AND lead_id = $2
        FOR UPDATE`,
      [input.campaignId, input.leadId],
    );
    const campaignStatus = campaign.rows[0]?.status;
    const enrollment = enrollmentResult.rows[0];
    if (
      !enrollment ||
      !['active', 'paused'].includes(enrollment.enrollment_status) ||
      enrollment.next_step_number !== execution.step_number
    ) {
      return { advanced: true, nextDedupeKey: null, nextGeneration: null };
    }

    if (input.next) {
      const isPaused = campaignStatus !== 'active' || enrollment.enrollment_status === 'paused';
      const generation = enrollment.scheduling_generation;
      const nextDedupeKey = isPaused
        ? null
        : buildDedupeKey({
            campaignId: input.campaignId,
            leadId: input.leadId,
            snapshotId: input.snapshotId,
            stepNumber: input.next.stepNumber,
            generation,
            attempt: input.next.attempt,
          });
      await client.query(
        `UPDATE campaign_leads
            SET next_step_number = $3,
                next_due_at = CASE WHEN $6 THEN NULL ELSE $4::timestamptz END,
                delay_remaining_ms = CASE WHEN $6 THEN $7::bigint ELSE NULL END,
                completed_steps = GREATEST(completed_steps, $5),
                execution_updated_at = NOW()
          WHERE campaign_id = $1 AND lead_id = $2`,
        [
          input.campaignId,
          input.leadId,
          input.next.stepNumber,
          input.next.dueAt,
          input.completedSteps,
          isPaused,
          input.next.delayRemainingMs,
        ],
      );
      if (isPaused || !nextDedupeKey) {
        return { advanced: true, nextDedupeKey: null, nextGeneration: null };
      }
      await client.query(
        `INSERT INTO campaign_step_executions
          (campaign_id, lead_id, snapshot_id, step_number, channel, template_id,
           generation, dedupe_key, state, due_at, mock_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unscheduled', $9::timestamptz, $10)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          input.campaignId,
          input.leadId,
          input.snapshotId,
          input.next.stepNumber,
          input.next.channel,
          input.next.templateId,
          generation,
          nextDedupeKey,
          input.next.dueAt,
          execution.mock_mode,
        ],
      );
      return { advanced: true, nextDedupeKey, nextGeneration: generation };
    }

    await client.query(
      `UPDATE campaign_leads
          SET enrollment_status = 'completed',
              next_step_number = NULL,
              next_due_at = NULL,
              delay_remaining_ms = NULL,
              completed_steps = $3,
              stop_reason = $4,
              execution_updated_at = NOW()
        WHERE campaign_id = $1 AND lead_id = $2`,
      [input.campaignId, input.leadId, input.completedSteps, input.terminalStopReason],
    );
    return { advanced: true, nextDedupeKey: null, nextGeneration: null };
  });
}

export interface ResumeIntentExecution {
  stepNumber: number;
  channel: string;
  templateId: string | null;
  snapshotId: string | null;
  mockMode: boolean;
}

/**
 * Resume one enrollment and persist its current-generation execution
 * atomically. The state transition and the intent are coupled: a duplicate
 * resume finds an active enrollment and reports a conflict instead of
 * scheduling twice, and an interrupted resume can never leave an active
 * enrollment with no intent. Transport publication happens after commit.
 */
export async function resumeEnrollmentTx(input: {
  campaignId: string;
  leadId: string;
  expectedGeneration: number;
  computedDueAt: string | null;
  expectedNextStepNumber?: number | null;
  clearTimingUnknown: boolean;
  execution: ResumeIntentExecution | null;
}): Promise<{ enrollment: EnrollmentStateRow; nextDedupeKey: string | null } | null> {
  return withTransaction(async (client) => {
    const resumed = await client.query<EnrollmentStateRow>(
      `UPDATE campaign_leads
          SET enrollment_status = 'active',
              pause_reason = NULL,
              next_due_at = $4::timestamptz,
              delay_remaining_ms = NULL,
              timing_unknown = CASE WHEN $5 THEN false ELSE timing_unknown END,
              scheduling_generation = scheduling_generation + 1,
              execution_updated_at = NOW()
        WHERE campaign_id = $1 AND lead_id = $2
          AND enrollment_status = 'paused'
          AND scheduling_generation = $3
          AND ($6::integer IS NULL OR next_step_number = $6)
        RETURNING campaign_id, lead_id, enrollment_status, sequence_snapshot_id,
          next_step_number, next_due_at, delay_remaining_ms, completed_steps,
          pause_reason, stop_reason, scheduling_generation, timing_unknown, mock_mode, execution_updated_at`,
      [
        input.campaignId,
        input.leadId,
        input.expectedGeneration,
        input.computedDueAt,
        input.clearTimingUnknown,
        input.expectedNextStepNumber ?? null,
      ],
    );
    const enrollment = resumed.rows[0];
    if (!enrollment) return null;
    if (!input.execution || enrollment.next_step_number == null) {
      return { enrollment, nextDedupeKey: null };
    }
    const nextDedupeKey = buildDedupeKey({
      campaignId: input.campaignId,
      leadId: input.leadId,
      snapshotId: input.execution.snapshotId,
      stepNumber: input.execution.stepNumber,
      generation: enrollment.scheduling_generation,
      attempt: 0,
    });
    await client.query(
      `INSERT INTO campaign_step_executions
        (campaign_id, lead_id, snapshot_id, step_number, channel, template_id,
         generation, dedupe_key, state, due_at, mock_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unscheduled', $9::timestamptz, $10)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        input.campaignId,
        input.leadId,
        input.execution.snapshotId,
        input.execution.stepNumber,
        input.execution.channel,
        input.execution.templateId,
        enrollment.scheduling_generation,
        nextDedupeKey,
        input.computedDueAt,
        input.execution.mockMode,
      ],
    );
    return { enrollment, nextDedupeKey };
  });
}

/**
 * Atomically persist a restored next-step intent for campaign resume:
 * enrollment timing plus the execution row commit together, so resume can
 * never strand an active enrollment without its intent.
 */
export async function restoreIntentTx(input: {
  campaignId: string;
  leadId: string;
  nextDueAt: string;
  nextStepNumber?: number;
  completedSteps?: number;
  completedStepNumber?: number;
  delayRemainingMs?: number;
  execution: ResumeIntentExecution & { generation: number };
}): Promise<{ nextDedupeKey: string } | { skipped: 'inactive' } | null> {
  return withTransaction(async (client) => {
    const campaign = await client.query<{ status: string }>(
      'SELECT status FROM campaigns WHERE id = $1 FOR UPDATE',
      [input.campaignId],
    );
    const found = await client.query<EnrollmentStateRow>(
      'SELECT * FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2 FOR UPDATE',
      [input.campaignId, input.leadId],
    );
    const enrollment = found.rows[0];
    if (!enrollment || !['active', 'paused'].includes(enrollment.enrollment_status)) {
      return { skipped: 'inactive' } as const;
    }
    if (
      enrollment.scheduling_generation !== input.execution.generation ||
      (input.completedStepNumber != null &&
        enrollment.next_step_number !== input.completedStepNumber)
    ) {
      return null;
    }
    const paused =
      campaign.rows[0]?.status !== 'active' || enrollment.enrollment_status === 'paused';
    if (paused && input.completedStepNumber == null) return { skipped: 'inactive' } as const;
    await client.query(
      `UPDATE campaign_leads
          SET next_step_number = COALESCE($5, next_step_number),
              next_due_at = CASE WHEN $6 THEN NULL ELSE $3::timestamptz END,
              delay_remaining_ms = CASE WHEN $6 THEN $7::bigint ELSE NULL END,
              completed_steps = GREATEST(COALESCE($4, completed_steps), completed_steps),
              execution_updated_at = NOW()
        WHERE campaign_id = $1 AND lead_id = $2`,
      [
        input.campaignId,
        input.leadId,
        input.nextDueAt,
        input.completedSteps ?? null,
        input.nextStepNumber ?? null,
        paused,
        input.delayRemainingMs ?? null,
      ],
    );
    if (paused) return { skipped: 'inactive' } as const;
    const nextDedupeKey = buildDedupeKey({
      campaignId: input.campaignId,
      leadId: input.leadId,
      snapshotId: input.execution.snapshotId,
      stepNumber: input.execution.stepNumber,
      generation: input.execution.generation,
      attempt: 0,
    });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO campaign_step_executions
        (campaign_id, lead_id, snapshot_id, step_number, channel, template_id,
         generation, dedupe_key, state, due_at, mock_mode)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unscheduled', $9::timestamptz, $10)
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id`,
      [
        input.campaignId,
        input.leadId,
        input.execution.snapshotId,
        input.execution.stepNumber,
        input.execution.channel,
        input.execution.templateId,
        input.execution.generation,
        nextDedupeKey,
        input.nextDueAt,
        input.execution.mockMode,
      ],
    );
    if ((inserted.rows.length ?? 0) === 0) return null;
    return { nextDedupeKey };
  });
}

/**
 * Atomically enroll a lead and persist its first-step intent: the pinned
 * snapshot, enrollment state, and first execution commit together, so an
 * enrollment can never be left active with no intent after a crash.
 */
export async function enrollIntentTx(input: {
  campaignId: string;
  leadId: string;
  snapshotId: string;
  firstStepNumber: number;
  firstDueAt: string;
  channel: string;
  templateId: string;
  generation: number;
  mockMode: boolean;
}): Promise<{ dedupeKey: string; inserted: boolean }> {
  const dedupeKey = buildDedupeKey({
    campaignId: input.campaignId,
    leadId: input.leadId,
    snapshotId: input.snapshotId,
    stepNumber: input.firstStepNumber,
    generation: input.generation,
    attempt: 0,
  });
  const inserted = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO campaign_leads
        (campaign_id, lead_id, enrollment_status, sequence_snapshot_id, next_step_number,
         next_due_at, completed_steps, stop_reason, timing_unknown, mock_mode)
       VALUES ($1, $2, 'active', $3, $4, $5::timestamptz, 0, NULL, false, $6)
       ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
         enrollment_status = 'active',
         sequence_snapshot_id = $3,
         next_step_number = $4,
         next_due_at = $5::timestamptz,
         pause_reason = NULL,
         stop_reason = NULL,
         timing_unknown = false,
         mock_mode = $6,
         execution_updated_at = NOW()`,
      [
        input.campaignId,
        input.leadId,
        input.snapshotId,
        input.firstStepNumber,
        input.firstDueAt,
        input.mockMode,
      ],
    );
    const exec = await client.query<{ id: string }>(
      `INSERT INTO campaign_step_executions
        (campaign_id, lead_id, snapshot_id, step_number, channel, template_id,
         generation, dedupe_key, state, due_at, mock_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unscheduled', $9::timestamptz, $10)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        input.campaignId,
        input.leadId,
        input.snapshotId,
        input.firstStepNumber,
        input.channel,
        input.templateId,
        input.generation,
        dedupeKey,
        input.firstDueAt,
        input.mockMode,
      ],
    );
    return (exec.rows.length ?? 0) > 0;
  });
  return { dedupeKey, inserted };
}

/**
 * Scheduled executions whose transport may be gone: due rows still marked
 * scheduled with no live lease. Parked jobs (flag-off consumption),
 * publication successes whose job record vanished, and crashed schedulers
 * all converge here. Claimed rows keep their lease protection; expired
 * leases are handled as uncertain outcomes, never republished blindly.
 */
export async function findStaleScheduledExecutions(limit: number): Promise<StepExecutionRow[]> {
  const result = await pool.query<StepExecutionRow>(
    `SELECT * FROM campaign_step_executions
      WHERE state = 'scheduled'
        AND due_at IS NOT NULL AND due_at <= NOW()
        AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
      ORDER BY due_at ASC
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}
