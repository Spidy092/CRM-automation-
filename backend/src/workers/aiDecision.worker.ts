/**
 * AI Decision Worker
 *
 * Consumes: `ai-decisions` queue
 *   - `ai:next-action` — compute the next-best-action for a lead
 *
 * Triggered by:
 *   - lead.created / lead.scored events
 *   - Manual re-computation via API (force=true)
 *
 * On success: returns { action, reason, confidence } and persists via
 *             computeNextBestAction.
 * On failure: error is re-thrown for BullMQ retry; exhausted jobs are
 *             routed to the DLQ.
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection, AI_DECISION_QUEUE } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { computeNextBestAction } from '../modules/ai-intelligence/ai-intelligence.service';

export interface AiDecisionJobData {
  leadId: string;
  force?: boolean;
  context?: Record<string, unknown>;
}

export async function handleAiDecisionJob(
  job: Job<AiDecisionJobData>,
): Promise<{ action: string; reason: string; confidence: number }> {
  const start = Date.now();
  const { leadId, force = false, context } = job.data;

  logger.info('ai decision: start', { jobId: job.id, leadId });

  try {
    const decision = await computeNextBestAction(leadId, { force, context });

    const durationSec = (Date.now() - start) / 1000;
    observeJobDuration({ name: job.name, queue: AI_DECISION_QUEUE }, durationSec);
    incJobsProcessed({ name: job.name, queue: AI_DECISION_QUEUE, status: 'success' });

    logger.info('ai decision: complete', {
      jobId: job.id,
      leadId,
      action: decision.action,
      confidence: decision.confidence,
      durationSec,
    });

    return decision;
  } catch (err) {
    incJobsFailed({ name: job.name, queue: AI_DECISION_QUEUE });
    logger.error('ai decision: failed', {
      jobId: job.id,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function startAiDecisionWorker(): Worker<AiDecisionJobData> {
  const worker = new Worker(AI_DECISION_QUEUE, handleAiDecisionJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });

  worker.on('ready', () => logger.info('ai decision worker ready', { queue: AI_DECISION_QUEUE }));

  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    const leadId = job?.data?.leadId ?? 'unknown';
    logger.error('ai decision job failed (worker event)', { id, leadId, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id, leadId } });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(AI_DECISION_QUEUE, {
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
