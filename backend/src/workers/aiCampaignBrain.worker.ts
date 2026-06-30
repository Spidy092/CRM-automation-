import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  getBullConnection,
  AI_CAMPAIGN_QUEUE,
  AI_CAMPAIGN_BRIEF,
  type AiGenerateCampaignBriefJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { generateCampaignBrief } from '../modules/ai-campaign-brain/ai-campaign-brain.service';

export async function handleAiCampaignBrainJob(job: Job<AiGenerateCampaignBriefJob>): Promise<{
  campaignId: string;
  briefId: string;
  confidence: number;
  highFitLeads: number;
}> {
  const start = Date.now();
  const { campaignId, triggeredBy } = job.data;
  const baseMeta = { jobId: job.id, jobName: job.name, campaignId };

  logger.info('ai campaign brain job started', baseMeta);

  const brief = await generateCampaignBrief(campaignId, triggeredBy);

  const durationSec = (Date.now() - start) / 1000;
  observeJobDuration({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE }, durationSec);
  incJobsProcessed({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE, status: 'success' });

  logger.info('ai campaign brain job completed', {
    ...baseMeta,
    durationSec,
    highFitLeads: brief.high_fit_leads,
    confidence: brief.confidence_score,
    autonomy: brief.recommended_autonomy_level,
  });

  return {
    campaignId,
    briefId: brief.id,
    confidence: brief.confidence_score,
    highFitLeads: brief.high_fit_leads,
  };
}

export function startAiCampaignBrainWorker(): Worker {
  const worker = new Worker(AI_CAMPAIGN_QUEUE, handleAiCampaignBrainJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 3,
  });

  worker.on('ready', () =>
    logger.info('ai campaign brain worker ready', { queue: AI_CAMPAIGN_QUEUE }),
  );

  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    const campaignId = job?.data?.campaignId ?? 'unknown';
    incJobsFailed({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE });
    logger.error('ai campaign brain job failed', { id, campaignId, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id, campaignId } });

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 2)) {
      void moveToDLQ(AI_CAMPAIGN_QUEUE, {
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
