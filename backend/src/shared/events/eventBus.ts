/**
 * Typed in-memory event bus + BullMQ publisher for AI domain events.
 *
 * `publishAIDomainEvent` enqueues events onto the `ai-events` BullMQ queue
 * with a deterministic job id so duplicate publishes are deduplicated.
 *
 * `subscribeToAIDomainEvents` registers typed handlers in a module-level
 * registry. Worker factories can later query `getHandlersForEvent` to wire
 * up BullMQ Workers without the bus itself owning the worker lifecycle.
 */

import { Queue, type ConnectionOptions } from 'bullmq';
import { logger } from '../utils/logger';
import { type AIDomainEvent, aiEventIdempotencyKey } from './ai.events';
import { AI_EVENTS_QUEUE, getBullConnection } from '../../workers/queue';

type AnyHandler = (event: AIDomainEvent) => Promise<void>;

const aiEventsQueue = new Queue(AI_EVENTS_QUEUE, {
  connection: getBullConnection() as unknown as ConnectionOptions,
});

const handlerRegistry = new Map<AIDomainEvent['type'], Set<AnyHandler>>();

function extractIdsFromPayload(
  payload: AIDomainEvent['payload'],
): { leadId?: string; campaignId?: string } {
  const record = payload as Record<string, unknown>;
  return {
    leadId: typeof record.lead_id === 'string' ? record.lead_id : undefined,
    campaignId: typeof record.campaign_id === 'string' ? record.campaign_id : undefined,
  };
}

/**
 * Publishes an AI domain event to the BullMQ `ai-events` queue.
 *
 * Uses an idempotency key derived from the event type + lead/campaign id so
 * duplicate publishes do not create duplicate jobs. Failures are logged but
 * never rethrown; event publishing should never crash the caller.
 */
export async function publishAIDomainEvent(event: AIDomainEvent): Promise<void> {
  const { leadId, campaignId } = extractIdsFromPayload(event.payload);

  logger.info('Publishing AI domain event', {
    event: event.type,
    leadId,
    campaignId,
  });

  const jobData = {
    event: event.type,
    payload: event.payload,
    enqueuedAt: new Date().toISOString(),
  };

  try {
    await aiEventsQueue.add(AI_EVENTS_QUEUE, jobData, {
      jobId: aiEventIdempotencyKey(event),
    });
  } catch (error) {
    logger.error('Failed to publish AI domain event', {
      event: event.type,
      leadId,
      campaignId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Registers typed handlers for one or more AI event types.
 *
 * Returns an unsubscribe function that removes exactly the handlers that
 * were registered by this call. The bus does not start a BullMQ Worker;
 * it only provides a registry that worker factories can iterate.
 */
export function subscribeToAIDomainEvents(
  handlers: Partial<{
    [K in AIDomainEvent['type']]: (event: Extract<AIDomainEvent, { type: K }>) => Promise<void>;
  }>,
): () => void {
  const registered: Array<{ type: AIDomainEvent['type']; handler: AnyHandler }> = [];

  for (const [type, handler] of Object.entries(handlers)) {
    if (!handler) continue;

    const eventType = type as AIDomainEvent['type'];
    const wrappedHandler = handler as AnyHandler;

    let set = handlerRegistry.get(eventType);
    if (!set) {
      set = new Set();
      handlerRegistry.set(eventType, set);
    }
    set.add(wrappedHandler);
    registered.push({ type: eventType, handler: wrappedHandler });
  }

  return () => {
    for (const { type, handler } of registered) {
      const set = handlerRegistry.get(type);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          handlerRegistry.delete(type);
        }
      }
    }
  };
}

/**
 * Returns all currently subscribed handlers for a given event type.
 */
export function getHandlersForEvent<K extends AIDomainEvent['type']>(
  type: K,
): Array<(event: Extract<AIDomainEvent, { type: K }>) => Promise<void>> {
  const handlers = handlerRegistry.get(type);
  return handlers
    ? (Array.from(handlers) as Array<(event: Extract<AIDomainEvent, { type: K }>) => Promise<void>>)
    : [];
}
