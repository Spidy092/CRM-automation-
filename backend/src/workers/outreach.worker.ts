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
import { findSequenceById } from '../modules/outreach/outreach.repository';
import {
  findCampaignById,
  countSentTodayForCampaign,
} from '../modules/campaigns/campaigns.repository';
import { computeDispatchDeferralMs } from '../modules/campaigns/campaigns.sendWindow';
import { createLog, updateLogStatus } from '../modules/outreach/outreach.service';
import { OutreachStatus } from '../shared/types';
import { dispatchOutbound } from '../modules/integrations/dispatch';
import { personalizeMessage } from '../modules/outreach/outreach.prompt';
import { findLeadById } from '../modules/leads/leads.repository';
import { findTemplateById } from '../modules/templates/templates.repository';
import { createTask } from '../modules/outreach/outreach.service';
import { pool } from '../shared/utils/db';

interface DispatchResult {
  success: boolean;
  externalId?: string;
  error?: string;
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

  // 1. Verify sequence still exists and the step is valid
  const sequence = await findSequenceById(sequenceId);
  if (!sequence) {
    throw new AppError(`Sequence ${sequenceId} not found`, 404);
  }
  const step = (sequence.steps as Array<{ stepNumber: number; channel: string }>).find(
    (s) => s.stepNumber === stepNumber,
  );
  if (!step) {
    throw new AppError(`Step ${stepNumber} not found in sequence ${sequenceId}`, 404);
  }

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
      const sentToday =
        campaign.daily_send_limit != null
          ? await countSentTodayForCampaign(campaignId, campaign.send_window_timezone || 'UTC')
          : null;
      const deferral = computeDispatchDeferralMs(campaign, sentToday);
      if (deferral.delayMs > 0) {
        const targetMinute = Math.ceil((Date.now() + deferral.delayMs) / 60_000);
        await enqueueOutreachDispatch(data, {
          jobIdSuffix: `deferred-${targetMinute}`,
          delayMs: deferral.delayMs,
        });
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
    await updateLogStatus(log.id, 'sent' as OutreachStatus, {
      externalMsgId: result.externalId,
      sentAt: new Date().toISOString(),
    });

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
    throw new AppError(`Dispatch failed for lead ${leadId} via ${channel}: ${result.error}`, 502);
  }

  // 5. Schedule next step via follow-up job
  const nextStep = (sequence.steps as Array<{ stepNumber: number; delayHours: number }>).find(
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
    throw new AppError(`AI reply dispatch failed for lead ${leadId} via ${channel}: ${outcome.error}`, 502);
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

  // 4. Personalize message
  const { message } = await personalizeMessage(lead, template, {
    enabled: opts.aiPersonalizationEnabled === true,
  });

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

  // 7. Call dispatch
  const outcome = await dispatchOutbound({
    leadId: opts.leadId,
    campaignId: opts.campaignId,
    channel: opts.channel,
    templateId: opts.templateId,
    body: message,
    destination,
    subject: template.subject ?? undefined,
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
