import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  getBullConnection,
  LEAD_EVENTS_QUEUE,
  LEAD_EVENT,
  scoringQueue,
  SCORING_CALCULATE_LEAD,
  cancelPendingOutreachJobs,
  enqueueOutreachDispatch,
  enqueueAiResearch,
  type LeadEventJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { findActiveCampaignsByPipeline, addLeadsToCampaign } from '../modules/campaigns/campaigns.repository';
import { findSequenceById } from '../modules/outreach/outreach.repository';
import { findLeadById } from '../modules/leads/leads.repository';
import { pushToUser } from '../modules/notifications/notifications.emitter';

/**
 * Lead Events Worker
 *
 * Consumes `lead-events` queue and triggers downstream automation:
 *   - lead.created       → enqueue scoring recalculation
 *   - lead.stage_moved   → auto-enroll lead in active campaigns targeting that pipeline
 *                          and dispatch first outreach step for each
 *   - lead.status_changed → cancel pending outreach when lead is paused/won/lost/opted_out
 *   - lead.assigned      → no-op (reserved for push notification)
 */
export function startEventsWorker(): Worker {
  const worker = new Worker(
    LEAD_EVENTS_QUEUE,
    async (job: Job<LeadEventJob>) => {
      const start = Date.now();
      logger.info('lead event job started', { jobId: job.id, event: job.data.event, leadId: job.data.leadId });

      try {
        await handleLeadEvent(job.data);

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: LEAD_EVENT, queue: LEAD_EVENTS_QUEUE }, durationSec);
        incJobsProcessed({ name: LEAD_EVENT, queue: LEAD_EVENTS_QUEUE, status: 'success' });
        logger.info('lead event job completed', { jobId: job.id, event: job.data.event, durationSec });
      } catch (err) {
        incJobsFailed({ name: LEAD_EVENT, queue: LEAD_EVENTS_QUEUE });
        logger.error('lead event job failed', {
          jobId: job.id,
          event: job.data.event,
          leadId: job.data.leadId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 20,
    },
  );

  worker.on('ready', () => logger.info('events worker ready', { queue: LEAD_EVENTS_QUEUE }));
  worker.on('failed', (job, err) => {
    logger.error('events worker failed event', {
      id: job?.id ?? 'unknown',
      event: (job?.data as LeadEventJob | undefined)?.event,
      error: err.message,
    });
    Sentry.captureException(err, { extra: { jobId: job?.id, event: (job?.data as LeadEventJob | undefined)?.event } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(LEAD_EVENTS_QUEUE, {
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

async function handleLeadEvent(data: LeadEventJob): Promise<void> {
  const { event, leadId, payload } = data;

  switch (event) {
    case 'lead.created':
      await scoringQueue.add(SCORING_CALCULATE_LEAD, { leadId });
      await enqueueAiResearch({ leadId });
      logger.info('lead.created → scoring + ai research enqueued', { leadId });
      break;

    case 'lead.stage_moved':
      await handleStageMoved(leadId, payload as { fromStageId: string | null; toStageId: string; pipelineId?: string });
      break;

    case 'lead.status_changed':
      await handleStatusChanged(leadId, payload as { status: string });
      break;

    case 'lead.assigned':
      logger.info('lead.assigned', { leadId, assignedTo: payload.assignedTo });
      break;

    case 'lead.scored':
      logger.info('lead.scored', { leadId, score: payload.score, classification: payload.classification });
      break;

    default:
      logger.warn('unknown lead event', { event, leadId });
  }
}

async function handleStageMoved(
  leadId: string,
  payload: { fromStageId: string | null; toStageId: string; pipelineId?: string },
): Promise<void> {
  const { toStageId, pipelineId } = payload;

  logger.info('lead.stage_moved', { leadId, toStageId, pipelineId });

  if (!pipelineId) {
    logger.warn('lead.stage_moved: pipelineId missing from payload, skipping auto-enrollment', { leadId, toStageId });
    return;
  }

  const campaigns = await findActiveCampaignsByPipeline(pipelineId);

  if (campaigns.length === 0) {
    logger.info('lead.stage_moved: no active campaigns for pipeline', { leadId, pipelineId });
    return;
  }

  for (const campaign of campaigns) {
    if (!campaign.sequence_id) continue;

    const sequence = await findSequenceById(campaign.sequence_id);
    if (!sequence) {
      logger.warn('campaign sequence not found, skipping enrollment', {
        leadId,
        campaignId: campaign.id,
        sequenceId: campaign.sequence_id,
      });
      continue;
    }

    const steps = sequence.steps as Array<{ stepNumber: number; channel: string; templateId: string; delayHours: number }>;
    if (!steps || steps.length === 0) {
      logger.warn('campaign sequence has no steps, skipping enrollment', {
        leadId,
        campaignId: campaign.id,
      });
      continue;
    }

    const firstStep = [...steps].sort((a, b) => a.stepNumber - b.stepNumber)[0];

    await addLeadsToCampaign(campaign.id, [leadId]);

    await enqueueOutreachDispatch({
      leadId,
      campaignId: campaign.id,
      sequenceId: campaign.sequence_id,
      stepNumber: firstStep.stepNumber,
      channel: firstStep.channel as 'whatsapp' | 'email' | 'sms' | 'phone_call',
      templateId: firstStep.templateId,
      mockMode: false,
      aiPersonalizationEnabled: campaign.ai_personalization_enabled,
    });

    // Push SSE notification to the lead's assigned rep (best-effort)
    const lead = await findLeadById(leadId).catch(() => null);
    if (lead?.assigned_to) {
      void pushToUser(lead.assigned_to, {
        id: `enroll:${campaign.id}:${leadId}`,
        type: 'campaign_enrolled',
        title: 'Lead enrolled in campaign',
        message: `${lead.business_name} was auto-enrolled in "${campaign.name}" after a stage move.`,
        data: { leadId, campaignId: campaign.id },
        timestamp: new Date().toISOString(),
      });
    }

    logger.info('lead auto-enrolled in campaign → outreach dispatched', {
      leadId,
      campaignId: campaign.id,
      pipelineId,
      toStageId,
      firstStepNumber: firstStep.stepNumber,
      channel: firstStep.channel,
    });
  }
}

async function handleStatusChanged(leadId: string, payload: { status: string }): Promise<void> {
  const { status } = payload;
  logger.info('lead.status_changed', { leadId, status });

  if (['paused', 'won', 'lost', 'opted_out'].includes(status)) {
    const removed = await cancelPendingOutreachJobs({ leadId });
    logger.info('lead.status_changed: cancelled pending outreach jobs', { leadId, status, removed });
  }
}
