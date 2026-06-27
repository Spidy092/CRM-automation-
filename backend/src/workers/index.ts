import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { logger } from '../shared/utils/logger';
import { redis } from '../shared/utils/redis';
import { startScoringWorker } from './scoring.worker';
import { startAssignmentWorker } from './assignment.worker';
import { startOutreachWorker } from './outreach.worker';
import { startReportExportWorker } from './reportExport.worker';
import { startScraperWorker } from './scraper.worker';
import { startEventsWorker } from './events.worker';
import { startAiResearchWorker } from './aiResearch.worker';
import { startAiReplyWorker } from './aiReply.worker';
import { startAiCampaignBrainWorker } from './aiCampaignBrain.worker';
import { startAiInboxWorker } from './aiInbox.worker';
import { startAiDecisionWorker } from './aiDecision.worker';

/**
 * CRM Worker Process
 *
 * Sprint 2 processors:
 *   - `scoring:calculate-lead` / `scoring:recalculate-all` (scoring.worker.ts)
 *   - `assignment:round-robin` (assignment.worker.ts)
 *
 * The scoring worker enqueues assignment jobs when a lead crosses into
 * the `hot` classification at or above `assignment_threshold`; the
 * assignment worker performs the round-robin pick and dispatches a
 * Slack/Teams notification (stub).
 *
 * Usage: `npm run worker`
 *
 * Env flags:
 *   - `WORKERS_DISABLED=true` short-circuits the startup for unit tests
 *     and CI environments that don't have Redis available.
 */

async function startWorkers(): Promise<void> {
  if (process.env.WORKERS_DISABLED === 'true') {
    logger.info('worker process disabled by WORKERS_DISABLED env');
    return;
  }

  logger.info('Worker process starting…');

  // Verify Redis connection before registering processors.
  try {
    await redis.ping();
    logger.info('Redis connection verified — worker process ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Worker process failed to connect to Redis', { error: message });
    process.exit(1);
  }

  const scoring = startScoringWorker();
  const assignment = startAssignmentWorker();
  const outreach = startOutreachWorker();
  const reportExport = startReportExportWorker();
  const scraper = startScraperWorker();
  const events = startEventsWorker();
  const aiResearch = startAiResearchWorker();
  const aiReply = startAiReplyWorker();
  const aiCampaignBrain = startAiCampaignBrainWorker();
  const aiInbox = startAiInboxWorker();
  const aiDecision = startAiDecisionWorker();

  logger.info('Worker process started — listening for jobs', {
    queues: [
      'scoring',
      'assignment',
      'outreach',
      'reports',
      'scraper',
      'lead-events',
      'ai-research',
      'ai-reply',
      'ai-campaign',
      'ai-inbox',
      'ai-decisions',
    ],
  });

  void scoring;
  void assignment;
  void outreach;
  void reportExport;
  void scraper;
  void events;
  void aiResearch;
  void aiReply;
  void aiCampaignBrain;
  void aiInbox;
  void aiDecision;
}

// Graceful shutdown
function handleShutdown(signal: string): void {
  logger.info(`Worker process received ${signal}, shutting down gracefully…`);
  void redis.quit().then(() => {
    logger.info('Redis connection closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

startWorkers().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('Worker process crashed on startup', { error: message });
  process.exit(1);
});
