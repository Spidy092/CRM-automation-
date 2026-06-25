import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection, SCRAPER_QUEUE, SCRAPER_RUN, type ScraperRunJob } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { AppError } from '../shared/middleware/errorHandler';
import { runScrape } from '../modules/scraper/scraper.service';

/**
 * Start the scraper worker.
 *
 * Consumes:
 *   - scraper:run — execute a scraper config (Google Places, Facebook, YouTube, or Web)
 *
 * Concurrency: 2 (to avoid overwhelming upstream APIs or the target web server).
 */
export function startScraperWorker(): Worker {
  const worker = new Worker(
    SCRAPER_QUEUE,
    async (job: Job) => {
      const start = Date.now();
      const baseMeta = { jobId: job.id, jobName: job.name, data: job.data as Record<string, unknown> };
      logger.info('scraper job started', baseMeta);

      try {
        if (job.name === SCRAPER_RUN) {
          const { configId, triggeredBy } = job.data as ScraperRunJob;
          const actor = { id: triggeredBy, role: 'admin', ipAddress: null };
          await runScrape(configId, actor);
        } else {
          throw new AppError(`Unknown scraper job: ${job.name}`, 500);
        }

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: SCRAPER_QUEUE }, durationSec);
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
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 2,
    },
  );

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
