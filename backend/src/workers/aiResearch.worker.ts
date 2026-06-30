/**
 * AI Research Worker
 *
 * Consumes: `ai-research` queue
 *   - `ai:research-lead` — run AI lead intelligence analysis and populate lead_ai_profiles
 *
 * Triggered by:
 *   - lead.created event (via events.worker → enqueueAiResearch)
 *   - lead.imported event (same path)
 *   - Manual re-research via API (force=true)
 *
 * On success: lead_ai_profiles row is upserted, ai_decision_log entry written,
 *             Redis cache invalidated.
 * On failure: enrichment_status set to 'failed', routed to DLQ after max retries.
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection, AI_RESEARCH_QUEUE, type AiResearchLeadJob } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { incAiResearch, observeAiResearchDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { researchLead } from '../modules/ai-intelligence/ai-intelligence.service';

export async function handleAiResearchJob(job: Job<AiResearchLeadJob>) {
  const start = Date.now();
  const { leadId, force = false } = job.data;
  const baseMeta = { jobId: job.id, jobName: job.name, leadId };

  logger.info('ai research job started', baseMeta);

  try {
    const profile = await researchLead(leadId, force);

    const durationSec = (Date.now() - start) / 1000;
    observeJobDuration({ name: job.name, queue: AI_RESEARCH_QUEUE }, durationSec);
    observeAiResearchDuration(durationSec);
    incJobsProcessed({ name: job.name, queue: AI_RESEARCH_QUEUE, status: 'success' });
    incAiResearch('success');

    logger.info('ai research job completed', {
      ...baseMeta,
      durationSec,
      enrichment_status: profile.enrichment_status,
      buying_intent: profile.buying_intent,
      next_best_action: profile.next_best_action,
    });

    return {
      leadId,
      enrichment_status: profile.enrichment_status,
      buying_intent: profile.buying_intent,
      next_best_action: profile.next_best_action,
    };
  } catch (err) {
    incJobsFailed({ name: job.name, queue: AI_RESEARCH_QUEUE });
    incAiResearch('failed');
    logger.error('ai research job failed', {
      ...baseMeta,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function startAiResearchWorker(): Worker {
  const worker = new Worker(AI_RESEARCH_QUEUE, handleAiResearchJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 5,
  });

  worker.on('ready', () => logger.info('ai research worker ready', { queue: AI_RESEARCH_QUEUE }));

  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    const leadId = job?.data?.leadId ?? 'unknown';
    logger.error('ai research job failed (worker event)', { id, leadId, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id, leadId } });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(AI_RESEARCH_QUEUE, {
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
