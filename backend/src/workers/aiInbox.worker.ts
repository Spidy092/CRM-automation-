import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  getBullConnection,
  AI_INBOX_QUEUE,
  AI_CREATE_INBOX_ITEM,
  type AiCreateInboxItemJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { createItem, runExpirySweep } from '../modules/ai-inbox/ai-inbox.service';

export async function handleAiInboxJob(
  job: Job<AiCreateInboxItemJob>,
): Promise<{ itemId?: string; swept?: number }> {
  const start = Date.now();

  // ── Expiry sweep (repeatable cron job — empty payload) ──────────────
  if (job.name === 'ai:expiry-sweep') {
    logger.info('ai inbox job started', { jobId: job.id, jobName: job.name });
    const swept = await runExpirySweep();
    const durationSec = (Date.now() - start) / 1000;
    observeJobDuration({ name: job.name, queue: AI_INBOX_QUEUE }, durationSec);
    incJobsProcessed({ name: job.name, queue: AI_INBOX_QUEUE, status: 'success' });
    logger.info('ai inbox expiry sweep completed', { jobId: job.id, swept, durationSec });
    return { swept };
  }

  // ── Create inbox item ───────────────────────────────────────────────
  const {
    assignedTo,
    leadId,
    campaignId,
    itemType,
    title,
    summary,
    urgencyScore,
    aiDraftResponse,
    aiDraftConfidence,
    expiresInHours,
  } = job.data;
  const baseMeta = { jobId: job.id, jobName: job.name, itemType, leadId, assignedTo };

  logger.info('ai inbox job started', baseMeta);

  const expiresAt =
    expiresInHours && expiresInHours > 0
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
      : undefined;

  const item = await createItem({
    assigned_to: assignedTo,
    lead_id: leadId,
    campaign_id: campaignId,
    item_type: itemType,
    title,
    summary,
    urgency_score: urgencyScore,
    ai_draft_response: aiDraftResponse,
    ai_draft_confidence: aiDraftConfidence,
    expires_at: expiresAt,
  });

  const durationSec = (Date.now() - start) / 1000;
  observeJobDuration({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE }, durationSec);
  incJobsProcessed({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE, status: 'success' });

  logger.info('ai inbox job completed', { ...baseMeta, durationSec, itemId: item.id });
  return { itemId: item.id };
}

export function startAiInboxWorker(): Worker {
  const worker = new Worker(AI_INBOX_QUEUE, handleAiInboxJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 20,
  });

  worker.on('ready', () => {
    logger.info('ai inbox worker ready', { queue: AI_INBOX_QUEUE });
    // Schedule repeatable expiry sweep every 30 minutes
    void (async () => {
      const { aiInboxQueue } = await import('./queue');
      await aiInboxQueue.add(
        'ai:expiry-sweep',
        {},
        { repeat: { every: 30 * 60 * 1000 }, jobId: 'ai:expiry-sweep:cron' },
      );
    })();
  });

  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    incJobsFailed({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE });
    logger.error('ai inbox job failed', { id, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id } });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(AI_INBOX_QUEUE, {
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
