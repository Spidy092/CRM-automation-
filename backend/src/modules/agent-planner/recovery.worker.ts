import { Worker, type ConnectionOptions, type Job, Queue } from 'bullmq';
import { getBullConnection } from '../../workers/queue';
import { logger } from '../../shared/utils/logger';
import { Sentry } from '../../shared/utils/sentry';
import { findStaleRunningPlans, updatePlanStatus } from './plan.repository';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../../shared/utils/metrics';

const RECOVERY_QUEUE = 'agent-plan-recovery';
const RECOVERY_JOB = 'agent-plan:recover-stale';

export async function runRecoverySweep(opts: { staleAfterSeconds: number }): Promise<number> {
  const stale = await findStaleRunningPlans(opts.staleAfterSeconds);
  let touched = 0;

  for (const plan of stale) {
    try {
      await updatePlanStatus(plan.id, 'failed', {
        errorMessage: 'stale_running_plan_recovered',
        completedAt: new Date().toISOString(),
      });
      logger.info('agent-plan recovery: marked stale plan as failed', { planId: plan.id });
      touched++;
    } catch (err) {
      logger.error('agent-plan recovery: failed to recover plan', {
        planId: plan.id,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, { extra: { planId: plan.id } });
    }
  }

  return touched;
}

async function handleRecoveryJob(job: Job): Promise<{ touched: number }> {
  const start = Date.now();
  logger.info('agent-plan recovery job started', { jobId: job.id });
  const touched = await runRecoverySweep({ staleAfterSeconds: 60 });
  const durationSec = (Date.now() - start) / 1000;
  observeJobDuration({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE }, durationSec);
  incJobsProcessed({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE, status: 'success' });
  logger.info('agent-plan recovery job completed', { jobId: job.id, touched, durationSec });
  return { touched };
}

export function startAgentPlanRecoveryWorker(): Worker {
  const worker = new Worker(RECOVERY_QUEUE, handleRecoveryJob, {
    connection: getBullConnection() as unknown as ConnectionOptions,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    incJobsFailed({ name: RECOVERY_JOB, queue: RECOVERY_QUEUE });
    Sentry.captureException(err, { extra: { jobId: job?.id } });
  });

  return worker;
}

export async function scheduleAgentPlanRecovery(): Promise<void> {
  const connection = getBullConnection() as unknown as ConnectionOptions;
  const queue = new Queue(RECOVERY_QUEUE, { connection });
  await queue.add(
    RECOVERY_JOB,
    {},
    {
      repeat: { every: 60_000 },
      jobId: `${RECOVERY_JOB}:cron`,
    },
  );
}
