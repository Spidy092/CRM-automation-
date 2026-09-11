import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  getBullConnection,
  OUTBOX_PUBLISH,
  OUTBOX_QUEUE,
  enqueueOutboxPublish,
  enqueueLeadEvent,
  type LeadEventJob,
  type OutboxPublishJob,
} from './queue';
import {
  claimOutboxEventById,
  findPendingOutboxEventIds,
  markOutboxEventFailed,
  markOutboxEventPublished,
} from '../shared/events/outbox.repository';
import { logger } from '../shared/utils/logger';
import { incJobsFailed, incJobsProcessed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import type { OutboxEventRow } from '../shared/events/outbox.types';

const allowedLeadEvents = new Set<LeadEventJob['event']>([
  'lead.created',
  'lead.updated',
  'lead.tag_added',
  'form.submitted',
  'message.event',
  'booking.created',
  'booking.cancelled',
  'lead.scored',
  'lead.stage_moved',
  'lead.assigned',
  'lead.status_changed',
  'lead.reply.received',
]);

function workerIdFor(job: Job<OutboxPublishJob>): string {
  return `outbox-${process.pid}-${job.id ?? 'unknown'}`.slice(0, 100);
}

function eventPayload(row: OutboxEventRow): LeadEventJob {
  const event = row.event_type as LeadEventJob['event'];
  if (!allowedLeadEvents.has(event)) {
    throw new Error(`Unsupported outbox event type '${row.event_type}'`);
  }
  const leadId = row.aggregate_id ?? row.payload.leadId;
  if (typeof leadId !== 'string' || leadId.length === 0) {
    throw new Error(`Outbox event '${row.id}' does not identify a lead aggregate`);
  }
  return {
    event,
    leadId,
    payload: row.payload,
    eventId: row.id,
  };
}

function retryAt(attempts: number): string {
  const delayMs = Math.min(60 * 60_000, 2 ** Math.min(attempts, 10) * 1_000);
  return new Date(Date.now() + delayMs).toISOString();
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

function recoveryJobSuffix(): string {
  return `recovery-${Math.floor(Date.now() / DEFAULT_SWEEP_INTERVAL_MS)}`;
}

export async function publishOutboxEvent(
  outboxEventId: string,
  workerId: string,
): Promise<{ status: string }> {
  const row = await claimOutboxEventById({ id: outboxEventId, workerId });
  if (!row) return { status: 'not_due_or_already_claimed' };

  try {
    await enqueueLeadEvent(eventPayload(row));
    const published = await markOutboxEventPublished(row.id, workerId);
    if (!published) throw new Error('Outbox publisher lease was lost before acknowledgement');
    return { status: 'published' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markOutboxEventFailed({
      id: row.id,
      workerId,
      error: message,
      nextAttemptAt: retryAt(row.attempts),
    });
    throw error;
  }
}

let outboxScheduler: NodeJS.Timeout | null = null;

/** Enqueues retryable rows without claiming them; the worker owns the lease. */
export async function sweepPendingOutboxEvents(limit = 100): Promise<number> {
  const ids = await findPendingOutboxEventIds(new Date().toISOString(), limit);
  const results = await Promise.allSettled(
    ids.map((outboxEventId) =>
      enqueueOutboxPublish({ outboxEventId }, { jobIdSuffix: recoveryJobSuffix() }),
    ),
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error('failed to enqueue pending outbox event', {
        outboxEventId: ids[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });
  return results.filter((result) => result.status === 'fulfilled').length;
}

export function startOutboxScheduler(intervalMs = DEFAULT_SWEEP_INTERVAL_MS): NodeJS.Timeout {
  if (outboxScheduler) return outboxScheduler;
  const tick = (): void => {
    void sweepPendingOutboxEvents().catch((error: unknown) => {
      logger.error('outbox pending-event sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  tick();
  outboxScheduler = setInterval(tick, intervalMs);
  outboxScheduler.unref();
  return outboxScheduler;
}

export function startOutboxWorker(): Worker<OutboxPublishJob> {
  const worker = new Worker<OutboxPublishJob>(
    OUTBOX_QUEUE,
    async (job) => {
      const start = Date.now();
      const workerId = workerIdFor(job);
      try {
        if (job.name !== OUTBOX_PUBLISH) throw new Error(`Unknown outbox job '${job.name}'`);
        const result = await publishOutboxEvent(job.data.outboxEventId, workerId);
        observeJobDuration({ name: job.name, queue: OUTBOX_QUEUE }, (Date.now() - start) / 1000);
        incJobsProcessed({ name: job.name, queue: OUTBOX_QUEUE, status: result.status });
        return result;
      } catch (error) {
        incJobsFailed({ name: job.name, queue: OUTBOX_QUEUE });
        logger.error('outbox publisher job failed', {
          jobId: job.id,
          outboxEventId: job.data.outboxEventId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { connection: getBullConnection() as unknown as ConnectionOptions, concurrency: 10 },
  );

  worker.on('ready', () => logger.info('outbox worker ready', { queue: OUTBOX_QUEUE }));
  worker.on('failed', (job, error) => {
    logger.error('outbox worker failed job', { jobId: job?.id, error: error.message });
    Sentry.captureException(error, { extra: { jobId: job?.id, queue: OUTBOX_QUEUE } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(OUTBOX_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: error.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });
  return worker;
}
