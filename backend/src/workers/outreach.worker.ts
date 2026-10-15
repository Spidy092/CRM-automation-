import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection } from './queue';
import {
  OUTREACH_QUEUE,
  OUTREACH_DISPATCH,
  OUTREACH_FOLLOW_UP,
  OUTREACH_STOP_CHECK,
  OUTREACH_SEND_AI_REPLY,
  enqueueOutreachDispatch,
  enqueueOutreachFollowUp,
  enqueueLeadEvent,
  type OutreachDispatchJob,
  type OutreachFollowUpJob,
  type OutreachStopCheckJob,
  type OutreachSendAiReplyJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { AppError } from '../shared/middleware/errorHandler';
import { findSequenceByIdIncludingDeleted as findSequenceById } from '../modules/outreach/outreach.repository';
import {
  findCampaignById,
  countSentTodayForCampaign,
} from '../modules/campaigns/campaigns.repository';
import { computeDispatchDeferralMs } from '../modules/campaigns/campaigns.sendWindow';
import { createLog, updateLogStatus } from '../modules/outreach/outreach.service';
import { OutreachStatus } from '../shared/types';
import { dispatchOutbound } from '../modules/integrations/dispatch';
import { getCampaignMessageSettings } from '../modules/campaigns/campaigns.service';
import { personalizeMessage } from '../modules/outreach/outreach.prompt';
import { createOutreachUnsubscribeUrl } from '../modules/outreach/unsubscribe.service';
import {
  leadToVariableValues,
  resolveEmailPayload,
  substituteVariables,
} from '../modules/templates/templateDesign';
import { isPlaceholderPhone, isPlaceholderEmail } from '../shared/utils/phone';
import { findLeadById } from '../modules/leads/leads.repository';
import { findTemplateById } from '../modules/templates/templates.repository';
import { createTask } from '../modules/outreach/outreach.service';
import { pool } from '../shared/utils/db';
import { buildTransportJobId } from './queue';
import { isCampaignOperationsV2Enabled } from '../modules/campaigns/campaigns.rollout';
import {
  evaluateDispatchGate,
  claimExecutionForWorker,
  recordClaimedOutcome,
  recordAcceptance,
  resolveExecutionSteps,
  lookupEnrollment,
  tryReserveCapacity,
} from '../modules/campaigns/campaigns.execution.service';
import {
  findExecutionByDedupeKey,
  markExecutionSkipped,
} from '../modules/campaigns/campaigns.execution.repository';
import { releaseClaimForRetry } from '../modules/campaigns/campaigns.execution.service';
import { computeDelayToNextLocalMidnightMs } from '../modules/campaigns/campaigns.sendWindow';

interface DispatchResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

/**
 * True when a destination is a scraper-generated placeholder rather than a
 * real contact (e.g. Google Places returned no phone/email for the
 * business — see scraper.service.ts generatePlaceholder{Phone,Email}).
 * Dispatching to these burns anti-ban budget and risks the sending
 * account's reputation on numbers/addresses that were never real.
 */
function isPlaceholderContact(
  channel: string,
  destination: string,
  sourcePlatform?: string,
): boolean {
  if (channel === 'email') {
    // Earlier Google imports invented deliverable-looking no-reply addresses.
    return (
      isPlaceholderEmail(destination) ||
      (sourcePlatform === 'google_business' && /^no-reply@/i.test(destination.trim()))
    );
  }
  return isPlaceholderPhone(destination);
}

export type StopCheckResult = { stopped: boolean; reason?: string };

/**
 * Start the outreach worker.
 *
 * Consumes:
 *   - outreach:dispatch-step  — render template + call connector (or mock)
 *   - outreach:schedule-follow-up — enqueue next step after delay
 *   - outreach:check-stop-condition — evaluate stop rules before scheduling
 *
 * Mock mode:
 *   When job.data.mockMode === true, the worker skips live API calls and
 *   returns a deterministic simulated dispatch result. This enables full
 *   end-to-end testing without real credentials.
 */
export function startOutreachWorker(): Worker {
  const worker = new Worker(
    OUTREACH_QUEUE,
    async (job: Job) => {
      const start = Date.now();
      const baseMeta = {
        jobId: job.id,
        jobName: job.name,
        data: job.data as Record<string, unknown>,
      };
      logger.info('outreach job started', baseMeta);

      try {
        if (job.name === OUTREACH_DISPATCH) {
          await handleDispatch(job.data as OutreachDispatchJob);
        } else if (job.name === OUTREACH_FOLLOW_UP) {
          await handleFollowUp(job.data as OutreachFollowUpJob);
        } else if (job.name === OUTREACH_STOP_CHECK) {
          await handleStopCheck(job.data as OutreachStopCheckJob);
        } else if (job.name === OUTREACH_SEND_AI_REPLY) {
          await handleSendAiReply(job.data as OutreachSendAiReplyJob);
        } else {
          throw new AppError(`Unknown outreach job: ${job.name}`, 500);
        }

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: OUTREACH_QUEUE }, durationSec);
        incJobsProcessed({ name: job.name, queue: OUTREACH_QUEUE, status: 'success' });
        logger.info('outreach job completed', {
          jobId: job.id,
          jobName: job.name,
          durationSec,
        });
      } catch (err) {
        incJobsFailed({ name: job.name, queue: OUTREACH_QUEUE });
        logger.error('outreach job failed', {
          jobId: job.id,
          jobName: job.name,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 10,
    },
  );

  worker.on('ready', () => logger.info('outreach worker ready', { queue: OUTREACH_QUEUE }));
  worker.on('failed', (job, err) => {
    logger.error('outreach worker failed event', {
      id: job?.id ?? 'unknown',
      name: job?.name,
      error: err.message,
    });
    Sentry.captureException(err, { extra: { jobId: job?.id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(OUTREACH_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });

  return worker;
}

// ── Dispatch Step (exported for testability) ───────────────────────────────

export async function handleDispatch(data: OutreachDispatchJob): Promise<void> {
  const {
    leadId,
    campaignId,
    sequenceId,
    stepNumber,
    channel,
    templateId,
    mockMode,
    aiPersonalizationEnabled,
  } = data;

  // Ownership is determined by the execution identity, never by the
  // rollout flag: a job carrying an executionId is always durable-owned.
  // The flag only grants permission to dispatch new durable work; parked
  // jobs (flag off) are retained for later recovery, never reinterpreted
  // as legacy sends.
  if (data.executionId) {
    await handleDurableDispatch(data);
    return;
  }

  // 1. Verify sequence still exists and the step is valid
  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    throw new AppError(`Sequence ${sequenceId} not found`, 404);
  }
  const steps = sequence.steps as Array<{ stepNumber: number; channel: string }>;
  const step = steps.find((s) => s.stepNumber === stepNumber);
  if (!step) {
    throw new AppError(`Step ${stepNumber} not found in sequence ${sequenceId}`, 404);
  }

  // Authoritative execution gate: campaign state, enrollment membership,
  // lead eligibility, opt-out/reply stops, and template approval are
  // rechecked here — for first sends, follow-ups, retries, and stale jobs.
  const gate = await evaluateDispatchGate({
    campaignId,
    leadId,
    stepNumber,
    templateId,
  });
  if (!gate.eligible) {
    if (gate.reason === 'template_unapproved') {
      // Fall through to the connector path so the failure is recorded on the
      // log exactly as before (failed status + 502 for visibility).
    } else {
      logger.info('dispatch skipped: execution gate blocked send', {
        leadId,
        campaignId,
        sequenceId,
        stepNumber,
        reason: gate.reason,
        detail: gate.detail,
      });
      return;
    }
  }

  await dispatchClaimedStep({
    leadId,
    campaignId,
    sequenceId,
    stepNumber,
    channel,
    templateId,
    mockMode,
    aiPersonalizationEnabled,
    steps: steps as Array<{
      stepNumber: number;
      channel: string;
      delayHours: number;
      templateId: string;
    }>,
    durable: false,
    snapshotId: null,
    originalData: data,
  });
}

/**
 * Durable-owned dispatch. Runs regardless of the rollout flag: with the flag
 * off the job is parked (recoverable state retained, nothing sent); with
 * the flag on it proceeds through gate → transactional claim → dispatch.
 */
export async function handleDurableDispatch(data: OutreachDispatchJob): Promise<void> {
  const {
    leadId,
    campaignId,
    sequenceId,
    stepNumber,
    channel,
    templateId,
    mockMode,
    aiPersonalizationEnabled,
  } = data;
  const executionId = data.executionId as string;

  const execution = await findExecutionByDedupeKey(executionId).catch(() => null);
  if (!execution) {
    logger.info('dispatch skipped: stale execution (no durable intent)', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
    });
    return;
  }

  if (!isCampaignOperationsV2Enabled()) {
    // Parked: the rollout flag only permits dispatch, it never changes
    // ownership. The execution row is untouched so re-enabling the flag lets
    // the recovery sweep republish it. Never send through the legacy path.
    logger.info('dispatch parked: durable sending is disabled by rollout flag', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
    });
    return;
  }

  let steps: Array<{
    stepNumber: number;
    channel: string;
    delayHours?: number;
    templateId?: string;
  }>;
  const snapshotId = execution.snapshot_id;
  try {
    steps = await resolveExecutionSteps({ snapshotId, sequenceId });
  } catch {
    await markExecutionSkipped(executionId, 'sequence unavailable').catch(() => undefined);
    return;
  }
  const step = steps.find((s) => s.stepNumber === stepNumber);
  if (!step) {
    await markExecutionSkipped(executionId, `Step ${stepNumber} not in sequence`).catch(
      () => undefined,
    );
    return;
  }

  const gate = await evaluateDispatchGate({
    campaignId,
    leadId,
    stepNumber,
    templateId,
    expectedGeneration: data.generation,
  });
  if (!gate.eligible) {
    await markExecutionSkipped(executionId, gate.detail ?? gate.reason ?? 'blocked').catch(
      () => undefined,
    );
    logger.info('dispatch skipped: execution gate blocked send', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
      reason: gate.reason,
      detail: gate.detail,
    });
    return;
  }

  // Transactional claim (see claimDueStepExecutionTx): revalidates campaign
  // status, enrollment status, and generation while holding the locks shared
  // with pause transitions. Stale generations, duplicates, recovery replays,
  // and retries that lost the race exit here without sending.
  const claimed = await claimExecutionForWorker({
    dedupeKey: executionId,
    expectedGeneration: data.generation ?? 0,
    workerId: `outreach-${process.pid}`,
  }).catch(() => null);
  if (!claimed) {
    logger.info('dispatch skipped: execution already claimed or stale', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
    });
    return;
  }

  try {
    await dispatchClaimedStep({
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
      channel,
      templateId,
      // The persisted execution mode is authoritative: recovery, resume,
      // and retry republish the row's mode, so a simulated send can never
      // be converted into real outreach downstream.
      mockMode: execution.mock_mode ?? mockMode,
      aiPersonalizationEnabled,
      steps: steps as Array<{
        stepNumber: number;
        channel: string;
        delayHours: number;
        templateId: string;
      }>,
      durable: true,
      executionId,
      snapshotId,
      originalData: { ...data, mockMode: execution.mock_mode ?? mockMode },
    });
  } catch (err) {
    // The claim stays held: a crash after provider acceptance must surface
    // as an uncertain outcome via the recovery sweep, never as a blind
    // duplicate resend. BullMQ retries cannot reclaim until the lease
    // expires, so they exit at the claim step above.
    logger.error('durable dispatch threw after claim — lease held for recovery', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function dispatchClaimedStep(opts: {
  leadId: string;
  campaignId: string;
  sequenceId: string;
  stepNumber: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  templateId: string;
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
  steps: Array<{ stepNumber: number; channel: string; delayHours: number; templateId: string }>;
  durable: boolean;
  executionId?: string;
  snapshotId: string | null;
  originalData: OutreachDispatchJob;
}): Promise<void> {
  const {
    leadId,
    campaignId,
    sequenceId,
    stepNumber,
    channel,
    templateId,
    mockMode,
    aiPersonalizationEnabled,
    steps,
    durable,
    executionId,
    originalData,
  } = opts;

  const stopResult = await handleStopCheck({
    leadId,
    campaignId,
    rules: [
      { type: 'replied' },
      { type: 'opted_out' },
      { type: 'paused' },
      { type: 'won' },
      { type: 'lost' },
    ],
  });
  if (stopResult.stopped) {
    if (durable && executionId) {
      await markExecutionSkipped(executionId, stopResult.reason ?? 'stop condition').catch(
        () => undefined,
      );
    }
    logger.info('dispatch skipped: stop condition met', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
      reason: stopResult.reason,
    });
    return;
  }

  // ── Send Window + Daily Cap Deferral ────────────────────────────────────
  // Messages (not phone-call tasks) respect the campaign's send window and
  // daily send limit: outside the window or over the cap, the job re-enqueues
  // itself with a delay instead of sending. The deferred job's id encodes the
  // target minute so repeated deferral evaluations dedupe instead of piling up.
  if (channel !== 'phone_call') {
    const campaign = await findCampaignById(campaignId);
    if (campaign) {
      if (durable) {
        const deferral = computeDispatchDeferralMs(
          campaign,
          campaign.daily_send_limit != null
            ? await countSentTodayForCampaign(campaignId, campaign.send_window_timezone || 'UTC')
            : null,
        );
        if (deferral.delayMs > 0) {
          await enqueueDeferredDispatch(originalData, deferral.delayMs);
          logger.info('dispatch deferred', {
            leadId,
            campaignId,
            sequenceId,
            stepNumber,
            reason: deferral.reason,
            delayMs: deferral.delayMs,
            resumesAt: new Date(Date.now() + deferral.delayMs).toISOString(),
          });
          await releaseClaimForDeferral(executionId);
          return;
        }
        // Atomic reservation: concurrent workers serialize here so the
        // campaign-local daily cap cannot overshoot. Fail closed: a
        // reservation error releases the claim back to a retryable pre-send
        // state and sends nothing — the connector is never called without a
        // successful required reservation. This is a pre-network failure,
        // distinct from an uncertain post-network outcome.
        let reserved: boolean;
        try {
          reserved = await tryReserveCapacity(campaign);
        } catch (err) {
          logger.error('capacity reservation failed — send blocked, claim released', {
            leadId,
            campaignId,
            sequenceId,
            stepNumber,
            error: err instanceof Error ? err.message : String(err),
          });
          await releaseClaimForDeferral(executionId);
          return;
        }
        if (!reserved) {
          const toMidnight = computeDelayToNextLocalMidnightMs(
            campaign.send_window_timezone || 'UTC',
          );
          await enqueueDeferredDispatch(originalData, toMidnight);
          logger.info('dispatch deferred: daily cap reached', {
            leadId,
            campaignId,
            sequenceId,
            stepNumber,
            delayMs: toMidnight,
          });
          await releaseClaimForDeferral(executionId);
          return;
        }
      } else {
        const sentToday =
          campaign.daily_send_limit != null
            ? await countSentTodayForCampaign(campaignId, campaign.send_window_timezone || 'UTC')
            : null;
        const deferral = computeDispatchDeferralMs(campaign, sentToday);
        if (deferral.delayMs > 0) {
          await enqueueDeferredDispatch(originalData, deferral.delayMs);
          logger.info('dispatch deferred', {
            leadId,
            campaignId,
            sequenceId,
            stepNumber,
            reason: deferral.reason,
            delayMs: deferral.delayMs,
            resumesAt: new Date(Date.now() + deferral.delayMs).toISOString(),
          });
          return;
        }
      }
    }
  }

  // 2. phone_call steps create a task row for the rep — never auto-dispatch.
  //    Source: TRD §5.11, PRD §6.1, outreach-sequence SKILL.md
  if (channel === 'phone_call') {
    // Look up the assigned_to for this lead so the task routes to the right rep.
    const lead = await findLeadById(leadId);
    await createTask(
      {
        leadId,
        campaignId,
        sequenceId,
        stepNumber,
        assignedTo: lead?.assigned_to ?? null,
        type: 'phone_call',
        title: `Call lead — step ${stepNumber}`,
        description: `Outreach sequence step ${stepNumber}: phone call required.`,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      // System actor for worker-originated tasks
      { id: 'system', role: 'admin', ipAddress: null },
    );
    logger.info('phone_call task created — skipping auto-dispatch', {
      leadId,
      campaignId,
      sequenceId,
      stepNumber,
    });
    // The next step is scheduled when the rep completes the task (see
    // updateTask → enqueueNextStepAfterTask), preserving manual-task
    // progression: creation never advances the sequence on its own.
    if (durable && executionId) {
      await recordClaimedOutcome({
        dedupeKey: executionId,
        campaign: (await findCampaignById(campaignId)) as never,
        outcome: 'sent',
        providerMsgId: null,
      }).catch(() => undefined);
    }

    return;
  }

  // 3. Create a log entry in 'queued' state (for non-phone-call channels)
  const log = await createLog({
    leadId,
    campaignId,
    channel,
    templateId,
    stepNumber,
    status: 'queued',
  });

  // 4. Call connector (or mock)
  const result = await sendViaConnector({
    leadId,
    campaignId,
    channel,
    templateId,
    mockMode,
    logId: log.id,
  });

  if (result.success) {
    const sentAt = new Date().toISOString();
    await updateLogStatus(log.id, 'sent' as OutreachStatus, {
      externalMsgId: result.externalId,
      sentAt,
    });

    if (durable && executionId) {
      // Acceptance, enrollment advancement, and the next intent commit in one
      // transaction (recordAcceptanceTx); publication follows the commit.
      // There is exactly one sent-marking — a separate outcome call here would
      // consume the claim and strand the follow-up.
      const campaign = await findCampaignById(campaignId);
      const enrollment = campaign ? await lookupEnrollment(campaignId, leadId) : null;
      const execution = await findExecutionByDedupeKey(executionId).catch(() => null);
      if (campaign && enrollment && execution) {
        await recordAcceptance({
          campaign,
          enrollment,
          execution: { ...execution, state: 'sent' },
          providerMsgId: result.externalId ?? null,
          steps: steps as Array<{
            stepNumber: number;
            channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
            delayHours: number;
            templateId: string;
          }>,
          sequenceId,
          mockMode,
          aiPersonalizationEnabled,
          acceptedAt: new Date(sentAt),
        }).catch((err) => {
          logger.error('failed to persist next-step intent after acceptance', {
            leadId,
            campaignId,
            stepNumber,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }

    // ── Automated Pipeline Stage Progression ────────────────────────────
    try {
      const lead = await findLeadById(leadId);
      if (lead && lead.pipeline_stage_id) {
        const stageQuery = await pool.query<{ pipeline_id: string }>(
          'SELECT pipeline_id FROM pipeline_stages WHERE id = $1',
          [lead.pipeline_stage_id],
        );
        if (stageQuery.rows.length > 0) {
          const pipelineId = stageQuery.rows[0].pipeline_id;
          const stagesQuery = await pool.query<{ id: string; name: string }>(
            'SELECT id, name FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position',
            [pipelineId],
          );

          let targetStageId: string | null = null;
          if (stepNumber === 1) {
            const contacted = stagesQuery.rows.find((s) =>
              s.name.toLowerCase().includes('contacted'),
            );
            if (contacted) targetStageId = contacted.id;
          } else if (stepNumber > 1) {
            const followUp = stagesQuery.rows.find(
              (s) =>
                s.name.toLowerCase().includes('follow-up') ||
                s.name.toLowerCase().includes('follow up'),
            );
            if (followUp) targetStageId = followUp.id;
          }

          if (targetStageId && targetStageId !== lead.pipeline_stage_id) {
            await pool.query('UPDATE leads SET pipeline_stage_id = $1 WHERE id = $2', [
              targetStageId,
              leadId,
            ]);
            await enqueueLeadEvent({
              event: 'lead.stage_moved',
              leadId,
              payload: {
                fromStageId: lead.pipeline_stage_id,
                toStageId: targetStageId,
                pipelineId,
              },
            });
            logger.info('automated pipeline progression triggered', {
              leadId,
              stepNumber,
              targetStageId,
            });
          }
        }
      }
    } catch (err) {
      logger.error('failed automated pipeline progression', {
        leadId,
        stepNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Smart Auto-Tagging ───────────────────────────────────────────────
    // Append behaviour tags to the lead without overwriting existing tags.
    try {
      const newTag = stepNumber === 1 ? 'contacted' : 'follow-up-sent';
      // Use PostgreSQL array functions to add tag only if not already present
      await pool.query(
        `UPDATE leads
         SET tags = array_append(tags, $1::text),
             updated_at = now()
         WHERE id = $2
           AND NOT ($1::text = ANY(tags))`,
        [newTag, leadId],
      );
      logger.info('smart tag applied', { leadId, tag: newTag, stepNumber });
    } catch (err) {
      logger.error('failed smart auto-tagging', {
        leadId,
        stepNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    await updateLogStatus(log.id, 'failed' as OutreachStatus, {
      errorMessage: result.error ?? 'Unknown dispatch error',
    });
    if (durable && executionId) {
      // Definite failure: record it durably, release the reserved capacity
      // slot, and return without throwing. BullMQ retries cannot reclaim a
      // failed execution, so they would only no-op; the failure surfaces via
      // operations/activity for review and explicit manual retry.
      const campaign = await findCampaignById(campaignId);
      if (campaign) {
        await recordClaimedOutcome({
          dedupeKey: executionId,
          campaign,
          outcome: 'failed',
          errorCategory: 'provider_error',
          errorMessage: result.error ?? 'Unknown dispatch error',
        });
      }
      return;
    }
    throw new AppError(`Dispatch failed for lead ${leadId} via ${channel}: ${result.error}`, 502);
  }

  if (durable) {
    // Next-step intent was already persisted by recordAcceptance above.
    return;
  }

  // 5. Schedule next step via follow-up job
  const nextStep = (steps as Array<{ stepNumber: number; delayHours: number }>).find(
    (s) => s.stepNumber === stepNumber + 1,
  );
  if (nextStep) {
    await enqueueOutreachFollowUp({
      leadId,
      campaignId,
      sequenceId,
      previousStepNumber: stepNumber,
      nextStepNumber: stepNumber + 1,
      delayHours: nextStep.delayHours ?? 24,
      mockMode,
      aiPersonalizationEnabled,
    });
  }
}

// ── Follow-up Scheduler (exported for testability) ─────────────────────────

/**
 * Re-enqueue a dispatch with a delay without piling up duplicates: the
 * deferred job id encodes the target minute so repeated evaluations dedupe.
 */
async function enqueueDeferredDispatch(data: OutreachDispatchJob, delayMs: number): Promise<void> {
  const targetMinute = Math.ceil((Date.now() + delayMs) / 60_000);
  await enqueueOutreachDispatch(data, {
    jobIdSuffix: data.executionId
      ? `${buildTransportJobId(data.executionId)}-deferred-${targetMinute}`
      : `deferred-${targetMinute}`,
    delayMs,
  });
}

/**
 * Release a durable claim when the worker defers instead of sending, so the
 * deferred wake-up can reclaim it. Deferral is not a failure: no outcome is
 * recorded and no capacity is consumed.
 */
async function releaseClaimForDeferral(executionId: string | undefined): Promise<void> {
  if (!executionId) return;
  await releaseClaimForRetry(executionId).catch(() => undefined);
}

export async function handleFollowUp(data: OutreachFollowUpJob): Promise<void> {
  const { leadId, campaignId, sequenceId, nextStepNumber, mockMode, aiPersonalizationEnabled } =
    data;

  // 1. Re-validate the sequence and step before dispatching
  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    logger.warn('follow-up aborted: sequence removed', { leadId, sequenceId });
    return;
  }
  const nextStep = (
    sequence.steps as Array<{
      stepNumber: number;
      channel: string;
      templateId: string;
    }>
  ).find((s) => s.stepNumber === nextStepNumber);
  if (!nextStep) {
    logger.warn('follow-up aborted: step removed', { leadId, sequenceId, nextStepNumber });
    return;
  }

  // Authoritative gate before scheduling the next send: a paused or deleted
  // campaign, removed enrollment, ineligible lead, or unapproved template
  // must not produce a new dispatch — including from already-queued
  // follow-ups that predate the pause.
  const gate = await evaluateDispatchGate({
    campaignId,
    leadId,
    stepNumber: nextStepNumber,
    templateId: nextStep.templateId,
  });
  if (!gate.eligible) {
    logger.info('follow-up skipped: execution gate blocked send', {
      leadId,
      campaignId,
      sequenceId,
      nextStepNumber,
      reason: gate.reason,
      detail: gate.detail,
    });
    return;
  }

  const stopResult = await handleStopCheck({
    leadId,
    campaignId,
    rules: [
      { type: 'max_messages', value: (sequence.steps as unknown[]).length },
      { type: 'replied' },
      { type: 'opted_out' },
      { type: 'paused' },
      { type: 'won' },
      { type: 'lost' },
    ],
  });
  if (stopResult.stopped) {
    logger.info('follow-up skipped: stop condition met', {
      leadId,
      campaignId,
      sequenceId,
      nextStepNumber,
      reason: stopResult.reason,
    });
    return;
  }

  // 2. Enqueue the actual dispatch job
  await enqueueOutreachDispatch({
    leadId,
    campaignId,
    sequenceId,
    stepNumber: nextStepNumber,
    channel: nextStep.channel as 'whatsapp' | 'email' | 'sms' | 'phone_call',
    templateId: nextStep.templateId,
    mockMode,
    aiPersonalizationEnabled,
  });
}

// ── AI Draft Reply Sender (exported for testability) ────────────────────────

/**
 * Sends a free-text AI-drafted reply (not template-driven). Reached only via
 * the agent policy engine — `outreach.send_ai_reply` — which gates on
 * autonomy level + confidence before ever enqueuing this job.
 */
export async function handleSendAiReply(data: OutreachSendAiReplyJob): Promise<void> {
  const { leadId, campaignId, channel, body } = data;

  const lead = await findLeadById(leadId);
  if (!lead) {
    throw new AppError(`Lead ${leadId} not found`, 404);
  }

  const destination = channel === 'email' ? lead.email : lead.phone;
  if (!destination) {
    throw new AppError(`Lead ${leadId} has no ${channel} destination`, 400);
  }
  if (isPlaceholderContact(channel, destination, lead.source_platform)) {
    throw new AppError(
      `Lead ${leadId} has a placeholder ${channel} (scraped without real contact info) — cannot dispatch`,
      400,
    );
  }

  const log = await createLog({
    leadId,
    campaignId,
    channel,
    templateId: null,
    messageBody: body,
    status: 'queued',
  });

  const outcome = await dispatchOutbound({
    leadId,
    campaignId: campaignId ?? '',
    channel,
    templateId: 'ai-reply-draft',
    body,
    destination,
    mockMode: false,
    logId: log.id,
  });

  if (outcome.ok) {
    await updateLogStatus(log.id, 'sent' as OutreachStatus, {
      externalMsgId: outcome.externalId,
      sentAt: new Date().toISOString(),
    });
  } else {
    await updateLogStatus(log.id, 'failed' as OutreachStatus, {
      errorMessage: outcome.error ?? 'Unknown dispatch error',
    });
    throw new AppError(
      `AI reply dispatch failed for lead ${leadId} via ${channel}: ${outcome.error}`,
      502,
    );
  }
}

// ── Stop Condition Checker (exported for testability) ──────────────────────

export async function handleStopCheck(data: OutreachStopCheckJob): Promise<StopCheckResult> {
  const { leadId, campaignId, rules } = data;
  const { findLogsByLead } = await import('../modules/outreach/outreach.repository');
  const { findLeadById } = await import('../modules/leads/leads.repository');

  const allLogs = (await findLogsByLead(leadId, 1_000)) ?? [];
  const logs = allLogs.filter((l) => l.campaign_id === campaignId);
  const lead = await findLeadById(leadId);

  for (const rule of rules) {
    if (rule.type === 'max_messages') {
      const max = typeof rule.value === 'number' ? rule.value : Infinity;
      const sentCount = logs.filter((l) =>
        ['sent', 'delivered', 'opened', 'replied'].includes(l.status),
      ).length;
      if (sentCount >= max) {
        logger.info('stop condition met: max_messages', { leadId, campaignId, sentCount, max });
        return { stopped: true, reason: 'max_messages' };
      }
    }

    if (rule.type === 'replied') {
      const hasReplied = logs.some((l) => l.status === 'replied' || l.replied_at != null);
      if (hasReplied) {
        logger.info('stop condition met: replied', { leadId, campaignId });
        return { stopped: true, reason: 'replied' };
      }
    }

    if (rule.type === 'opted_out') {
      if (lead?.status === 'opted_out') {
        logger.info('stop condition met: opted_out', { leadId, campaignId });
        return { stopped: true, reason: 'opted_out' };
      }
    }

    if (rule.type === 'paused' && lead?.status === 'paused') {
      logger.info('stop condition met: paused', { leadId, campaignId });
      return { stopped: true, reason: 'paused' };
    }

    if (rule.type === 'won' && lead?.status === 'won') {
      logger.info('stop condition met: won', { leadId, campaignId });
      return { stopped: true, reason: 'won' };
    }

    if (rule.type === 'lost' && lead?.status === 'lost') {
      logger.info('stop condition met: lost', { leadId, campaignId });
      return { stopped: true, reason: 'lost' };
    }

    if (rule.type === 'no_engagement') {
      const windows = typeof rule.value === 'number' ? rule.value : 3;
      const recentLogs = logs.filter((l) => l.step_number != null).slice(0, windows);
      const hasEngagement = recentLogs.some((l) =>
        ['opened', 'replied', 'delivered'].includes(l.status),
      );
      if (!hasEngagement && recentLogs.length >= windows) {
        logger.info('stop condition met: no_engagement', { leadId, campaignId, windows });
        return { stopped: true, reason: 'no_engagement' };
      }
    }
  }

  return { stopped: false };
}

// ── Connector Dispatch ─────────────────────────────────────────────────────

async function sendViaConnector(opts: {
  leadId: string;
  campaignId: string;
  channel: string;
  templateId: string;
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
  logId?: string;
}): Promise<DispatchResult> {
  if (opts.mockMode) {
    logger.info('mock dispatch', { leadId: opts.leadId, channel: opts.channel });
    return {
      success: true,
      externalId: `mock-${opts.channel}-${Date.now()}`,
    };
  }

  // 1. Fetch lead
  const lead = await findLeadById(opts.leadId);
  if (!lead) {
    return { success: false, error: 'Lead not found' };
  }

  // 2. Fetch template
  const template = await findTemplateById(opts.templateId);
  if (!template) {
    return { success: false, error: 'Template not found' };
  }

  // 3. Verify approval
  if (template.approval_status !== 'approved') {
    return { success: false, error: 'Template not approved' };
  }

  // 4. Personalize message. Visual/custom-HTML email templates use the saved
  // rendered HTML with deterministic substitution (AI rewriting is intentionally
  // skipped there to preserve the designed layout); simple templates keep the
  // existing AI-personalization path.
  const settings = await getCampaignMessageSettings(opts.campaignId);
  const enabled = settings?.ai_personalization_enabled ?? opts.aiPersonalizationEnabled === true;
  const values = leadToVariableValues(lead);

  let message: string;
  let subject: string | undefined;
  if (opts.channel === 'email' && template.editor_mode !== 'simple' && template.html_body) {
    values.unsubscribe_link = await createOutreachUnsubscribeUrl(lead.id, lead.email);
    const payload = resolveEmailPayload(template, values);
    message = payload.html;
    subject = payload.subject ?? undefined;
  } else {
    const personalized = await personalizeMessage(lead, template, {
      enabled,
      ...(enabled && settings ? { tone: settings.tone } : {}),
    });
    message = personalized.message;
    subject = template.subject ? substituteVariables(template.subject, values, false) : undefined;
  }

  // 5. Determine destination
  let destination: string;
  if (opts.channel === 'email') {
    destination = lead.email;
  } else if (
    opts.channel === 'sms' ||
    opts.channel === 'whatsapp' ||
    opts.channel === 'phone_call'
  ) {
    destination = lead.phone;
  } else {
    return { success: false, error: `Unknown channel: ${opts.channel}` };
  }

  // 6. Validate destination
  if (!destination) {
    return { success: false, error: `Lead has no ${opts.channel} destination` };
  }
  if (isPlaceholderContact(opts.channel, destination, lead.source_platform)) {
    return {
      success: false,
      error: `Lead has a placeholder ${opts.channel} (scraped without real contact info) — cannot dispatch`,
    };
  }

  // 7. Call dispatch
  const outcome = await dispatchOutbound({
    leadId: opts.leadId,
    campaignId: opts.campaignId,
    channel: opts.channel,
    templateId: opts.templateId,
    body: message,
    destination,
    subject: subject ?? template.subject ?? undefined,
    mockMode: opts.mockMode,
    logId: opts.logId,
    attachments: template.attachments,
  });

  // 8. Map outcome to result
  if (outcome.ok === true) {
    return { success: true, externalId: outcome.externalId };
  } else {
    return { success: false, error: outcome.error };
  }
}
