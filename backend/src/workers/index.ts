import 'dotenv/config';
import { logger } from '../shared/utils/logger';
import { redis } from '../shared/utils/redis';
import { startScoringWorker } from './scoring.worker';
import { startAssignmentWorker } from './assignment.worker';

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

  logger.info('Worker process started — listening for jobs', {
    queues: ['scoring', 'assignment'],
  });

  // Touch the worker handles so TypeScript doesn't complain about unused
  // bindings and so the references are kept alive for the lifetime of the
  // process.
  void scoring;
  void assignment;
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
