jest.mock('./outbox.repository', () => ({
  appendOutboxEvent: jest.fn(),
}));

jest.mock('../../workers/queue', () => ({
  enqueueOutboxPublish: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn() },
}));

import { enqueueOutboxPublish } from '../../workers/queue';
import { appendOutboxEvent } from './outbox.repository';
import { appendDomainEvent, enqueueOutboxDelivery } from './outbox.service';
import type { OutboxEventRow } from './outbox.types';

const mockedAppend = appendOutboxEvent as jest.Mock;
const mockedEnqueue = enqueueOutboxPublish as jest.Mock;

const event: OutboxEventRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  event_type: 'lead.created',
  aggregate_type: 'lead',
  aggregate_id: 'lead-1',
  idempotency_key: 'lead-created-lead-1',
  payload: { lead: { id: 'lead-1', name: 'Ada' } },
  status: 'pending',
  attempts: 0,
  next_attempt_at: '2026-09-07T00:00:00.000Z',
  locked_at: null,
  locked_by: null,
  published_at: null,
  last_error: null,
  created_at: '2026-09-07T00:00:00.000Z',
  updated_at: '2026-09-07T00:00:00.000Z',
};

describe('outbox service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates and appends a durable event', async () => {
    mockedAppend.mockResolvedValueOnce({ event, created: true });

    await expect(
      appendDomainEvent({
        eventType: 'lead.created',
        aggregateType: 'lead',
        aggregateId: 'lead-1',
        idempotencyKey: 'lead-created-lead-1',
        payload: event.payload,
      }),
    ).resolves.toEqual({ ok: true, value: { event, created: true } });
  });

  it('rejects malformed events before touching the repository', async () => {
    await expect(
      appendDomainEvent({
        eventType: 'Lead Created',
        idempotencyKey: 'bad key',
        payload: { ok: true },
      }),
    ).resolves.toMatchObject({ ok: false, error: { statusCode: 422 } });
    expect(mockedAppend).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for different event data', async () => {
    mockedAppend.mockResolvedValueOnce({
      event: { ...event, payload: { lead: { id: 'other-lead' } } },
      created: false,
    });

    await expect(
      appendDomainEvent({
        eventType: 'lead.created',
        aggregateType: 'lead',
        aggregateId: 'lead-1',
        idempotencyKey: 'lead-created-lead-1',
        payload: event.payload,
      }),
    ).resolves.toMatchObject({ ok: false, error: { statusCode: 409 } });
  });

  it('enqueues a stable delivery job only for a valid UUID', async () => {
    mockedEnqueue.mockResolvedValueOnce(undefined);
    await expect(enqueueOutboxDelivery(event.id)).resolves.toEqual({ ok: true, value: undefined });
    expect(mockedEnqueue).toHaveBeenCalledWith({ outboxEventId: event.id });

    await expect(enqueueOutboxDelivery('not-an-id')).resolves.toMatchObject({
      ok: false,
      error: { statusCode: 422 },
    });
  });

  it('returns a service error when queue scheduling fails', async () => {
    mockedEnqueue.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(enqueueOutboxDelivery(event.id)).resolves.toMatchObject({
      ok: false,
      error: { statusCode: 503 },
    });
  });
});
