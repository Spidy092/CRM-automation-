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
  enqueueAiDecision,
  enqueueAiCreateInboxItem,
  type LeadEventJob,
  type OutreachDispatchJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import {
  findActiveCampaignsByPipeline,
  addLeadsToCampaign,
} from '../modules/campaigns/campaigns.repository';
import {
  findSequenceById,
  findNextBestActionByLeadId,
} from '../modules/outreach/outreach.repository';
import { findLeadById } from '../modules/leads/leads.repository';
import { findUserById } from '../modules/users/users.repository';
import { proposeAgentAction } from '../modules/agent/agent.service';
import type { AgentActor } from '../modules/agent/agent.types';
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
      logger.info('lead event job started', {
        jobId: job.id,
        event: job.data.event,
        leadId: job.data.leadId,
      });

      try {
        await handleLeadEvent(job.data);

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: LEAD_EVENT, queue: LEAD_EVENTS_QUEUE }, durationSec);
        incJobsProcessed({ name: LEAD_EVENT, queue: LEAD_EVENTS_QUEUE, status: 'success' });
        logger.info('lead event job completed', {
          jobId: job.id,
          event: job.data.event,
          durationSec,
        });
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
      event: job?.data?.event,
      error: err.message,
    });
    Sentry.captureException(err, {
      extra: { jobId: job?.id, event: job?.data?.event },
    });
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

export async function handleLeadEvent(data: LeadEventJob): Promise<void> {
  const { event, leadId, payload } = data;

  switch (event) {
    case 'lead.created':
      await scoringQueue.add(SCORING_CALCULATE_LEAD, { leadId });
      await enqueueAiResearch({ leadId });
      logger.info('lead.created → scoring + ai research enqueued', { leadId });
      break;

    case 'lead.stage_moved':
      await handleStageMoved(
        leadId,
        payload as { fromStageId: string | null; toStageId: string; pipelineId?: string },
      );
      break;

    case 'lead.status_changed':
      await handleStatusChanged(leadId, payload as { status: string });
      break;

    case 'lead.assigned':
      logger.info('lead.assigned', { leadId, assignedTo: payload.assignedTo });
      break;

    case 'lead.scored':
      logger.info('lead.scored', {
        leadId,
        score: payload.score,
        classification: payload.classification,
      });
      await enqueueAiDecision({
        leadId,
        force: true,
        context: { score: payload.score, classification: payload.classification },
      });
      break;

    default:
      logger.warn('unknown lead event', { event, leadId });
  }
}

export async function handleStageMoved(
  leadId: string,
  payload: { fromStageId: string | null; toStageId: string; pipelineId?: string },
): Promise<void> {
  const { toStageId, pipelineId } = payload;

  logger.info('lead.stage_moved', { leadId, toStageId, pipelineId });

  if (!pipelineId) {
    logger.warn('lead.stage_moved: pipelineId missing from payload, skipping auto-enrollment', {
      leadId,
      toStageId,
    });
    return;
  }

  const campaigns = await findActiveCampaignsByPipeline(pipelineId);

  if (campaigns.length === 0) {
    logger.info('lead.stage_moved: no active campaigns for pipeline', { leadId, pipelineId });
    return;
  }

  const nextBestAction = await findNextBestActionByLeadId(leadId);

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

    const steps = sequence.steps as Array<{
      stepNumber: number;
      channel: string;
      templateId: string;
      delayHours: number;
    }>;
    if (!steps || steps.length === 0) {
      logger.warn('campaign sequence has no steps, skipping enrollment', {
        leadId,
        campaignId: campaign.id,
      });
      continue;
    }

    const firstStep = [...steps].sort((a, b) => a.stepNumber - b.stepNumber)[0];

    await addLeadsToCampaign(campaign.id, [leadId]);

    const routed = await routeByNextBestAction({
      leadId,
      campaign,
      firstStep,
      nextBestAction,
    });

    if (routed) {
      logger.info('lead auto-enrolled in campaign → outreach routed by next_best_action', {
        leadId,
        campaignId: campaign.id,
        pipelineId,
        toStageId,
        firstStepNumber: firstStep.stepNumber,
        action: nextBestAction?.action,
      });
      continue;
    }

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

type SequenceStep = { stepNumber: number; channel: string; templateId: string; delayHours: number };

async function routeByNextBestAction(options: {
  leadId: string;
  campaign: {
    id: string;
    sequence_id: string | null;
    name: string;
    ai_personalization_enabled?: boolean;
    autonomy_level?: 'supervised' | 'guarded' | 'autopilot';
    ai_min_confidence?: number;
  };
  firstStep: SequenceStep;
  nextBestAction: { action: string; reason: string; confidence: number } | null;
}): Promise<boolean> {
  const { leadId, campaign, firstStep, nextBestAction } = options;
  if (!nextBestAction) {
    return false;
  }

  const skipActions = new Set(['disqualify', 'wait_and_followup', 'request_human_approval']);
  if (skipActions.has(nextBestAction.action)) {
    logger.info('lead.stage_moved: skipping outreach per next_best_action', {
      leadId,
      campaignId: campaign.id,
      action: nextBestAction.action,
      reason: nextBestAction.reason,
      confidence: nextBestAction.confidence,
    });
    await createReviewInboxItemForLead({ leadId, campaignId: campaign.id, nextBestAction });
    return true;
  }

  const channelSwitchActions: Record<string, OutreachDispatchJob['channel']> = {
    send_email: 'email',
    send_sms: 'sms',
    send_whatsapp: 'whatsapp',
  };
  if (channelSwitchActions[nextBestAction.action]) {
    const channel = channelSwitchActions[nextBestAction.action];
    const actor = await resolveAssignedLeadActor(leadId);
    if (!actor) {
      logger.warn('lead.stage_moved: no assigned actor for next_best_action outreach, routing to review', {
        leadId,
        campaignId: campaign.id,
        action: nextBestAction.action,
      });
      await createReviewInboxItemForLead({ leadId, campaignId: campaign.id, nextBestAction });
      return true;
    }

    const proposal = await proposeAgentAction({
      source: 'ai_decision',
      actionName: 'outreach.send_manual',
      args: {
        leadId,
        campaignId: campaign.id,
        sequenceId: campaign.sequence_id as string,
        stepNumber: firstStep.stepNumber,
        channel,
        templateId: firstStep.templateId,
        mockMode: false,
      },
      actor,
      assignTo: actor.id,
      confidence: nextBestAction.confidence,
      autonomyLevel: campaign.autonomy_level ?? 'guarded',
      aiMinConfidence: campaign.ai_min_confidence ?? 70,
      sourceMessage: nextBestAction.reason,
    });

    logger.info('lead.stage_moved: outreach channel routed through agent action', {
      leadId,
      campaignId: campaign.id,
      action: nextBestAction.action,
      channel,
      reason: nextBestAction.reason,
      confidence: nextBestAction.confidence,
      policyOutcome: proposal.policy.outcome,
      agentActionId: proposal.action?.id ?? null,
    });
    return true;
  }

  const logSkipActions = new Set(['call', 'escalate_to_rep', 'move_to_nurture', 'request_review']);
  if (logSkipActions.has(nextBestAction.action)) {
    logger.info('lead.stage_moved: outreach skipped per next_best_action', {
      leadId,
      campaignId: campaign.id,
      action: nextBestAction.action,
      reason: nextBestAction.reason,
      confidence: nextBestAction.confidence,
    });

    if (['escalate_to_rep', 'move_to_nurture', 'call', 'request_review'].includes(nextBestAction.action)) {
      await createReviewInboxItemForLead({ leadId, campaignId: campaign.id, nextBestAction });
    }
    return true;
  }

  return false;
}


async function resolveAssignedLeadActor(leadId: string): Promise<AgentActor | null> {
  const lead = await findLeadById(leadId).catch(() => null);
  if (!lead?.assigned_to) return null;

  const user = await findUserById(lead.assigned_to).catch(() => null);
  if (!user || !user.is_active) return null;

  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  };
}

async function createReviewInboxItemForLead(options: {
  leadId: string;
  campaignId: string;
  nextBestAction: { action: string; reason: string; confidence: number };
}): Promise<void> {
  const lead = await findLeadById(options.leadId).catch(() => null);
  if (!lead?.assigned_to) return;

  await enqueueAiCreateInboxItem({
    assignedTo: lead.assigned_to,
    leadId: options.leadId,
    campaignId: options.campaignId,
    itemType: options.nextBestAction.action === 'escalate_to_rep' ? 'lead_handoff' : 'approve_response',
    title: `Review AI next action: ${options.nextBestAction.action}`,
    summary: options.nextBestAction.reason,
    urgencyScore: Math.min(100, Math.max(40, options.nextBestAction.confidence)),
    aiDraftConfidence: options.nextBestAction.confidence,
  });
}

async function handleStatusChanged(leadId: string, payload: { status: string }): Promise<void> {
  const { status } = payload;
  logger.info('lead.status_changed', { leadId, status });

  if (['paused', 'won', 'lost', 'opted_out'].includes(status)) {
    const removed = await cancelPendingOutreachJobs({ leadId });
    logger.info('lead.status_changed: cancelled pending outreach jobs', {
      leadId,
      status,
      removed,
    });
  }
}
