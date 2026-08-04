import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection, SCRAPER_QUEUE, SCRAPER_RUN, type ScraperRunJob } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { AppError } from '../shared/middleware/errorHandler';
import { runScrape, runScrapeForJob } from '../modules/scraper/scraper.service';

/**
 * Processes a single scraper job. Exported (rather than inlined in the
 * Worker callback) so it can be unit tested without spinning up BullMQ.
 *
 * Two run shapes share this queue:
 *   - Background "Run Now" runs (`queueScrapeRun`) — the log row already
 *     exists, created synchronously by the HTTP handler; `job.data.logId`
 *     is set, so this reuses it via `runScrapeForJob`.
 *   - Scheduled (cron) runs (`scraper.scheduler.ts`) — no log exists yet;
 *     this falls back to `runScrape`, which creates one.
 */
export async function handleScraperJob(job: Job): Promise<void> {
  const start = Date.now();
  const baseMeta = {
    jobId: job.id,
    jobName: job.name,
    data: job.data as Record<string, unknown>,
  };
  logger.info('scraper job started', baseMeta);

  try {
    let result;
    if (job.name === SCRAPER_RUN) {
      const { configId, triggeredBy, logId } = job.data as ScraperRunJob;
      if (logId) {
        result = await runScrapeForJob(configId, logId);
      } else {
        const actor = { id: triggeredBy, role: 'admin', ipAddress: null };
        result = await runScrape(configId, actor);
      }
    } else {
      throw new AppError(`Unknown scraper job: ${job.name}`, 500);
    }

    // The service never throws on a scrape failure — it writes the reason to
    // the log row and returns status 'failed' so the HTTP layer can render it.
    // Left alone, that reads here as a clean return: the job would be counted
    // as a success, BullMQ would never retry it, and the DLQ would never see
    // it. Convert a retryable failure back into a throw so the queue's
    // attempts/backoff/DLQ configuration actually applies.
    if (result.status === 'failed' && result.retryable) {
      throw new AppError(`Scraper run failed: ${result.errorMessage ?? 'Unknown error'}`, 502);
    }

    const durationSec = (Date.now() - start) / 1000;
    observeJobDuration({ name: job.name, queue: SCRAPER_QUEUE }, durationSec);
    // A non-retryable failure is still a failed run, not a success — count it
    // as such even though we deliberately do not retry it.
    if (result.status === 'failed') {
      incJobsFailed({ name: job.name, queue: SCRAPER_QUEUE });
      logger.warn('scraper job finished with a permanent failure; not retrying', {
        jobId: job.id,
        jobName: job.name,
        durationSec,
        error: result.errorMessage,
      });
      return;
    }
    incJobsProcessed({ name: job.name, queue: SCRAPER_QUEUE, status: 'success' });
    logger.info('scraper job completed', { jobId: job.id, jobName: job.name, durationSec });
  } catch (err) {
    incJobsFailed({ name: job.name, queue: SCRAPER_QUEUE });
    logger.error('scraper job failed', {
      jobId: job.id,
      jobName: job.name,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Start the scraper worker.
 *
 * Consumes:
 *   - scraper:run — execute a scraper config (Google Places, Facebook, YouTube, or Web)
 *
 * Concurrency: 2 (to avoid overwhelming upstream APIs or the target web server).
 */
export function startScraperWorker(): Worker {
  const worker = new Worker(SCRAPER_QUEUE, handleScraperJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 2,
  });

  worker.on('ready', () => logger.info('scraper worker ready', { queue: SCRAPER_QUEUE }));
  worker.on('failed', (job, err) => {
    logger.error('scraper worker failed event', {
      id: job?.id ?? 'unknown',
      name: job?.name,
      error: err.message,
    });
    Sentry.captureException(err, { extra: { jobId: job?.id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(SCRAPER_QUEUE, {
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
