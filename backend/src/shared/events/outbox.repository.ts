import type { Pool, PoolClient } from 'pg';
import { AppError } from '../middleware/errorHandler';
import { pool } from '../utils/db';
import type {
  OutboxAppendResult,
  OutboxClaimInput,
  OutboxEventInput,
  OutboxEventRow,
} from './outbox.types';

export type OutboxDbExecutor = Pool | PoolClient;

const OUTBOX_COLUMNS = `
  id, event_type, aggregate_type, aggregate_id, idempotency_key, payload,
  status, attempts, next_attempt_at, locked_at, locked_by, published_at,
  last_error, created_at, updated_at`;
const MAX_OUTBOX_ATTEMPTS = 10;

/**
 * Appends an event to the outbox. Pass a PoolClient when the event must commit
 * atomically with a domain write. The idempotency key is the only dedupe key;
 * a duplicate returns the existing immutable event and does not mutate it.
 */
export async function appendOutboxEvent(
  input: OutboxEventInput,
  executor: OutboxDbExecutor = pool,
): Promise<OutboxAppendResult> {
  const inserted = await executor.query<OutboxEventRow>(
    `INSERT INTO event_outbox
       (event_type, aggregate_type, aggregate_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING ${OUTBOX_COLUMNS}`,
    [
      input.eventType,
      input.aggregateType ?? null,
      input.aggregateId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.payload),
    ],
  );

  if (inserted.rows[0]) return { event: inserted.rows[0], created: true };

  const existing = await findOutboxEventByIdempotencyKey(input.idempotencyKey, executor);
  if (!existing) {
    throw new AppError('Failed to read idempotent outbox event', 500);
  }
  return { event: existing, created: false };
}

export async function findOutboxEventById(
  id: string,
  executor: OutboxDbExecutor = pool,
): Promise<OutboxEventRow | null> {
  const result = await executor.query<OutboxEventRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM event_outbox WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findOutboxEventByIdempotencyKey(
  idempotencyKey: string,
  executor: OutboxDbExecutor = pool,
): Promise<OutboxEventRow | null> {
  const result = await executor.query<OutboxEventRow>(
    `SELECT ${OUTBOX_COLUMNS} FROM event_outbox WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

/**
 * Claims a bounded batch using row locks. Expired publishing leases are
 * reclaimable, so a crashed publisher cannot strand an event permanently.
 */
export async function claimPendingOutboxEvents(input: OutboxClaimInput): Promise<OutboxEventRow[]> {
  const limit = input.limit;
  const leaseSeconds = input.leaseSeconds ?? 300;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('Outbox claim limit must be between 1 and 100', 422);
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new AppError('Outbox lease must be between 30 and 3600 seconds', 422);
  }
  if (!input.workerId || input.workerId.length > 100) {
    throw new AppError('Outbox worker id is invalid', 422);
  }

  const now = input.now ?? new Date().toISOString();
  const result = await pool.query<OutboxEventRow>(
    `WITH claimable AS (
       SELECT id
       FROM event_outbox
       WHERE (
         status IN ('pending', 'failed')
         AND attempts < ${MAX_OUTBOX_ATTEMPTS}
         AND next_attempt_at <= $1::timestamptz
       )
       OR (
         status = 'publishing'
         AND attempts < ${MAX_OUTBOX_ATTEMPTS}
         AND locked_at IS NOT NULL
         AND locked_at < $1::timestamptz - ($4 * INTERVAL '1 second')
       )
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE event_outbox AS e
     SET status = 'publishing', locked_at = NOW(), locked_by = $3,
         attempts = e.attempts + 1, updated_at = NOW()
     FROM claimable
     WHERE e.id = claimable.id
     RETURNING ${OUTBOX_COLUMNS}`,
    [now, limit, input.workerId, leaseSeconds],
  );
  return result.rows;
}

/**
 * Returns retryable event IDs for the scheduler. This query deliberately does
 * not claim rows; the publisher performs the lease/CAS claim immediately before
 * dispatch so duplicate scheduler ticks remain harmless.
 */
export async function findPendingOutboxEventIds(
  now = new Date().toISOString(),
  limit = 100,
  leaseSeconds = 300,
): Promise<string[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('Outbox sweep limit must be between 1 and 100', 422);
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new AppError('Outbox lease must be between 30 and 3600 seconds', 422);
  }
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM event_outbox
       WHERE (
         status IN ('pending', 'failed')
         AND attempts < ${MAX_OUTBOX_ATTEMPTS}
         AND next_attempt_at <= $1::timestamptz
       )
       OR (
         status = 'publishing'
         AND attempts < ${MAX_OUTBOX_ATTEMPTS}
         AND locked_at IS NOT NULL
       AND locked_at < $1::timestamptz - ($3 * INTERVAL '1 second')
     )
     ORDER BY created_at, id
     LIMIT $2`,
    [now, limit, leaseSeconds],
  );
  return result.rows.map((row) => row.id);
}

/** Claims one explicitly queued event while preserving publisher ownership. */
export async function claimOutboxEventById(input: {
  id: string;
  workerId: string;
  now?: string;
  leaseSeconds?: number;
}): Promise<OutboxEventRow | null> {
  const now = input.now ?? new Date().toISOString();
  const leaseSeconds = input.leaseSeconds ?? 300;
  if (!input.workerId || input.workerId.length > 100) {
    throw new AppError('Outbox worker id is invalid', 422);
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new AppError('Outbox lease must be between 30 and 3600 seconds', 422);
  }
  const result = await pool.query<OutboxEventRow>(
    `UPDATE event_outbox
     SET status = 'publishing', locked_at = NOW(), locked_by = $2,
         attempts = attempts + 1, updated_at = NOW()
     WHERE id = $1
       AND (
         (status IN ('pending', 'failed') AND attempts < ${MAX_OUTBOX_ATTEMPTS}
          AND next_attempt_at <= $3::timestamptz)
         OR (status = 'publishing' AND attempts < ${MAX_OUTBOX_ATTEMPTS}
             AND locked_at IS NOT NULL
             AND locked_at < $3::timestamptz - ($4 * INTERVAL '1 second'))
       )
     RETURNING ${OUTBOX_COLUMNS}`,
    [input.id, input.workerId, now, leaseSeconds],
  );
  return result.rows[0] ?? null;
}

export async function markOutboxEventPublished(
  id: string,
  workerId: string,
): Promise<OutboxEventRow | null> {
  const result = await pool.query<OutboxEventRow>(
    `UPDATE event_outbox
     SET status = 'published', published_at = NOW(), locked_at = NULL,
         locked_by = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'publishing' AND locked_by = $2
     RETURNING ${OUTBOX_COLUMNS}`,
    [id, workerId],
  );
  return result.rows[0] ?? null;
}

export async function markOutboxEventFailed(input: {
  id: string;
  workerId: string;
  error: string;
  nextAttemptAt: string;
}): Promise<OutboxEventRow | null> {
  const result = await pool.query<OutboxEventRow>(
    `UPDATE event_outbox
     SET status = 'failed', next_attempt_at = $3::timestamptz,
         locked_at = NULL, locked_by = NULL, last_error = $4, updated_at = NOW()
     WHERE id = $1 AND status = 'publishing' AND locked_by = $2
     RETURNING ${OUTBOX_COLUMNS}`,
    [input.id, input.workerId, input.nextAttemptAt, input.error.slice(0, 2_000)],
  );
  return result.rows[0] ?? null;
}
