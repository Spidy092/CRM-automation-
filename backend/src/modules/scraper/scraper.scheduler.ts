/**
 * Cron scheduling for scraper configs, backed by BullMQ repeatable jobs.
 *
 * Each active config with a `schedule_cron` gets one repeatable job on the
 * scraper queue, keyed by a stable jobId derived from the config id so it can
 * be found and removed again without persisting the BullMQ repeat key
 * anywhere. The job carries no `logId` — the worker creates a fresh log row
 * itself when a scheduled run actually fires (see scraper.worker.ts).
 */
import { scraperQueue, SCRAPER_RUN, type ScraperRunJob } from '../../workers/queue';
import { findActiveScraperConfigs } from './scraper.repository';
import { logger } from '../../shared/utils/logger';

function scheduleJobId(configId: string): string {
  return `scraper-schedule-${configId}`;
}

/** Removes the repeatable job for a config, if one is registered. Idempotent. */
export async function removeSchedule(configId: string): Promise<void> {
  const jobId = scheduleJobId(configId);
  const repeatables = await scraperQueue.getRepeatableJobs();
  const match = repeatables.find((r) => r.id === jobId);
  if (!match) return;
  await scraperQueue.removeRepeatableByKey(match.key);
  logger.info('scraper schedule removed', { configId });
}

/**
 * Reconciles a single config's repeatable job against its current
 * `schedule_cron` + `is_active` state: removes any existing job for the
 * config, then re-adds it if the config is active with a cron set.
 */
export async function syncSchedule(
  configId: string,
  cron: string | null | undefined,
  isActive: boolean,
): Promise<void> {
  await removeSchedule(configId);
  if (!cron || !isActive) return;

  const payload: ScraperRunJob = { configId, triggeredBy: 'scheduler' };
  await scraperQueue.add(SCRAPER_RUN, payload, {
    repeat: { pattern: cron },
    jobId: scheduleJobId(configId),
  });
  logger.info('scraper schedule registered', { configId, cron });
}

/**
 * Re-registers repeatable jobs for every active config with a cron on
 * process startup, in case the BullMQ/Redis repeatable-job state was lost
 * (e.g. Redis flush) since configs were last created/updated. Safe to call
 * repeatedly — `syncSchedule` always removes before adding.
 */
export async function reconcileSchedules(): Promise<void> {
  const configs = await findActiveScraperConfigs();
  const withCron = configs.filter((c) => !!c.schedule_cron);
  for (const config of withCron) {
    try {
      await syncSchedule(config.id, config.schedule_cron, config.is_active);
    } catch (err) {
      logger.error('failed to reconcile scraper schedule', {
        configId: config.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info('scraper schedules reconciled', { count: withCron.length });
}
