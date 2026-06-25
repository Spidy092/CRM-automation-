import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection, AI_REPLY_QUEUE, AI_CLASSIFY_REPLY, type AiClassifyReplyJob } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { classifyReply } from '../modules/ai-reply/ai-reply.service';

export function startAiReplyWorker(): Worker {
  const worker = new Worker(
    AI_REPLY_QUEUE,
    async (job: Job<AiClassifyReplyJob>) => {
      const start = Date.now();
      const { leadId, channel, messageText, externalMessageId } = job.data;
      const baseMeta = { jobId: job.id, jobName: job.name, leadId, channel };

      logger.info('ai reply job started', baseMeta);

      const result = await classifyReply({ leadId, channel, messageText, externalMessageId });

      const durationSec = (Date.now() - start) / 1000;
      observeJobDuration({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE }, durationSec);
      incJobsProcessed({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE, status: 'success' });

      logger.info('ai reply job completed', {
        ...baseMeta,
        durationSec,
        intent: result.intent_class,
        confidence: result.confidence,
        requiresHumanReview: result.requires_human_review,
      });

      return {
        leadId,
        intent_class: result.intent_class,
        confidence: result.confidence,
        requires_human_review: result.requires_human_review,
      };
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 10,
    },
  );

  worker.on('ready', () => logger.info('ai reply worker ready', { queue: AI_REPLY_QUEUE }));

  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    const leadId = (job?.data as AiClassifyReplyJob | undefined)?.leadId ?? 'unknown';
    incJobsFailed({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE });
    logger.error('ai reply job failed', { id, leadId, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id, leadId } });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(AI_REPLY_QUEUE, {
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
