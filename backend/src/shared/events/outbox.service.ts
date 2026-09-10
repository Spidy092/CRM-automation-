import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { err, ok, type Result } from '../utils/result';
import { enqueueOutboxPublish } from '../../workers/queue';
import { appendOutboxEvent, type OutboxDbExecutor } from './outbox.repository';
import type { OutboxAppendResult, OutboxJsonObject, OutboxJsonValue } from './outbox.types';

const MAX_OUTBOX_PAYLOAD_BYTES = 256 * 1024;

const outboxJsonValueSchema: z.ZodType<OutboxJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(outboxJsonValueSchema),
    z.record(z.string(), outboxJsonValueSchema),
  ]),
);

export const outboxEventInputSchema = z
  .object({
    eventType: z.string().regex(/^[a-z][a-z0-9_.:-]{0,149}$/),
    aggregateType: z.string().trim().min(1).max(80).nullable().optional(),
    aggregateId: z.string().trim().min(1).max(255).nullable().optional(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
    payload: z.record(z.string(), outboxJsonValueSchema),
  })
  .strict()
  .superRefine((input, context) => {
    const size = Buffer.byteLength(JSON.stringify(input.payload), 'utf8');
    if (size > MAX_OUTBOX_PAYLOAD_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_OUTBOX_PAYLOAD_BYTES,
        type: 'string',
        inclusive: true,
        path: ['payload'],
        message: `Payload must be at most ${MAX_OUTBOX_PAYLOAD_BYTES} bytes`,
      });
    }
  });

export type OutboxEventInput = z.infer<typeof outboxEventInputSchema>;

const outboxEventIdSchema = z.string().uuid();

function canonicalize(value: OutboxJsonValue): OutboxJsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<OutboxJsonObject>((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function sameEvent(existing: OutboxAppendResult['event'], input: OutboxEventInput): boolean {
  return (
    existing.event_type === input.eventType &&
    existing.aggregate_type === (input.aggregateType ?? null) &&
    existing.aggregate_id === (input.aggregateId ?? null) &&
    JSON.stringify(canonicalize(existing.payload)) === JSON.stringify(canonicalize(input.payload))
  );
}

/**
 * Validates and persists an event. Supplying a PoolClient makes this operation
 * part of the caller's domain transaction; the service never sends to Redis.
 */
export async function appendDomainEvent(
  input: unknown,
  executor?: OutboxDbExecutor,
): Promise<Result<OutboxAppendResult, AppError>> {
  const parsed = outboxEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new AppError(
        `Invalid outbox event: ${parsed.error.issues[0]?.message ?? 'invalid input'}`,
        422,
      ),
    );
  }

  try {
    const persisted = await appendOutboxEvent(parsed.data, executor);
    if (!persisted.created && !sameEvent(persisted.event, parsed.data)) {
      return err(new AppError('Outbox idempotency key is already used by another event', 409));
    }
    return ok(persisted);
  } catch (error) {
    logger.error('Failed to append domain event to outbox', {
      eventType: parsed.data.eventType,
      aggregateType: parsed.data.aggregateType,
      aggregateId: parsed.data.aggregateId,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to persist domain event', 500));
  }
}

/**
 * Adds a stable queue job for a persisted event. Delivery is intentionally
 * separate from append so a Redis outage leaves the database row retryable.
 */
export async function enqueueOutboxDelivery(
  outboxEventId: string,
): Promise<Result<void, AppError>> {
  const parsedId = outboxEventIdSchema.safeParse(outboxEventId);
  if (!parsedId.success) return err(new AppError('Outbox event id is invalid', 422));

  try {
    await enqueueOutboxPublish({ outboxEventId: parsedId.data });
    return ok(undefined);
  } catch (error) {
    logger.error('Failed to enqueue outbox delivery', {
      outboxEventId: parsedId.data,
      error: error instanceof Error ? error.message : String(error),
    });
    return err(new AppError('Failed to enqueue outbox delivery', 503));
  }
}
