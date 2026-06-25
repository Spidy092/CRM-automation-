/**
 * Dead-Letter Queue (DLQ) — catch-bin for BullMQ jobs that exhaust all
 * retry attempts.
 *
 * When a job fails its final attempt, the worker's `failed` handler calls
 * `moveToDLQ()` to enqueue a diagnostic snapshot to the `dead-letter` queue.
 * This preserves the original payload, failure reason, and attempt count so
 * operators can inspect, replay, or discard the job.
 *
 * The DLQ queue itself uses a longer retention period (30 days) so no data
 * is lost over a weekend.
 */
import { Queue } from 'bullmq';
import { getBullConnection } from '../workers/queue';
import { logger } from '../shared/utils/logger';

const DLQ_QUEUE_NAME = 'dead-letter';

let dlqQueue: Queue | null = null;

function getDLQQueue(): Queue {
  if (!dlqQueue) {
    dlqQueue = new Queue(DLQ_QUEUE_NAME, {
      connection: getBullConnection() as unknown as import('bullmq').ConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: { count: 1_000, age: 30 * 24 * 60 * 60 },
        removeOnFail: { count: 1_000, age: 30 * 24 * 60 * 60 },
      },
    });
  }
  return dlqQueue;
}

export interface DLQPayload {
  originalQueue: string;
  originalJobId: string | undefined;
  originalJobName: string;
  originalData: unknown;
  failedReason: string | undefined;
  attemptsMade: number;
  movedAt: string;
}

/**
 * Move a failed BullMQ job to the dead-letter queue for manual inspection.
 *
 * This is called from the worker's `failed` event handler when
 * `job.attemptsMade >= (job.opts?.attempts ?? 3)`.
 */
export async function moveToDLQ(
  originalQueue: string,
  job: {
    id?: string;
    name: string;
    data: unknown;
    failedReason?: string;
    attemptsMade?: number;
  },
): Promise<void> {
  const payload: DLQPayload = {
    originalQueue,
    originalJobId: job.id,
    originalJobName: job.name,
    originalData: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade ?? 0,
    movedAt: new Date().toISOString(),
  };

  try {
    await getDLQQueue().add(`${originalQueue}:${job.name}`, payload);
    logger.warn('Job moved to DLQ', {
      originalQueue,
      jobId: job.id,
      jobName: job.name,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
    });
  } catch (err) {
    logger.error('Failed to move job to DLQ', {
      originalQueue,
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Register a `failed` event handler on a worker that moves exhausted jobs to the DLQ. */
export function registerDLQHandler(
  worker: { on: (event: string, handler: (...args: unknown[]) => void) => void },
  queueName: string,
): void {
  worker.on('failed', (...args: unknown[]) => {
    const job = args[0] as
      | {
          id?: string;
          name: string;
          data: unknown;
          attemptsMade: number;
          opts?: { attempts?: number };
        }
      | undefined;
    const err = args[1] as Error | undefined;
    if (!job || !err) return;

    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      void moveToDLQ(queueName, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });
}
