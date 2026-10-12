import { logger } from '../shared/utils/logger';
import { notifyDueFollowUps } from '../modules/leads/leads.service';

const FOLLOW_UP_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let scheduler: NodeJS.Timeout | null = null;

export function startFollowUpNotificationScheduler(): NodeJS.Timeout {
  if (scheduler) return scheduler;
  const tick = (): void => {
    void notifyDueFollowUps(1000)
      .then((count) => {
        if (count > 0) logger.info('due follow-up notifications created', { count });
      })
      .catch((error: unknown) => {
        logger.error('due follow-up notification sweep failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };
  tick();
  scheduler = setInterval(tick, FOLLOW_UP_SWEEP_INTERVAL_MS);
  scheduler.unref();
  return scheduler;
}
