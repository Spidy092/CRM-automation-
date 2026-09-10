jest.mock('../utils/db', () => ({
  pool: { query: jest.fn() },
}));

import { pool } from '../utils/db';
import {
  appendOutboxEvent,
  claimPendingOutboxEvents,
  findPendingOutboxEventIds,
  findOutboxEventById,
  findOutboxEventByIdempotencyKey,
  markOutboxEventFailed,
  markOutboxEventPublished,
} from './outbox.repository';
import type { OutboxEventRow } from './outbox.types';

const mockedQuery = pool.query as jest.Mock;

const event: OutboxEventRow = {
  id: 'event-1',
  event_type: 'lead.created',
  aggregate_type: 'lead',
  aggregate_id: 'lead-1',
  idempotency_key: 'lead-created-lead-1',
  payload: { leadId: 'lead-1' },
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

describe('outbox repository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a new event and returns created=true', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [event] });

    await expect(
      appendOutboxEvent({
        eventType: event.event_type,
        aggregateType: event.aggregate_type,
        aggregateId: event.aggregate_id,
        idempotencyKey: event.idempotency_key,
        payload: event.payload,
      }),
    ).resolves.toEqual({ event, created: true });
    expect(mockedQuery.mock.calls[0]?.[0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });

  it('returns the existing immutable row when a key is duplicated', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [event] });

    await expect(
      appendOutboxEvent({
        eventType: event.event_type,
        idempotencyKey: event.idempotency_key,
        payload: event.payload,
      }),
    ).resolves.toEqual({ event, created: false });
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('reads rows by id and idempotency key', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [event] });
    await expect(findOutboxEventById(event.id)).resolves.toEqual(event);
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await expect(findOutboxEventByIdempotencyKey('missing')).resolves.toBeNull();
  });

  it('claims a bounded batch and increments attempts in SQL', async () => {
    const claimed = { ...event, status: 'publishing' as const, attempts: 1, locked_by: 'worker-1' };
    mockedQuery.mockResolvedValueOnce({ rows: [claimed] });

    await expect(
      claimPendingOutboxEvents({
        limit: 10,
        workerId: 'worker-1',
        now: '2026-09-07T00:00:00.000Z',
        leaseSeconds: 120,
      }),
    ).resolves.toEqual([claimed]);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      '2026-09-07T00:00:00.000Z',
      10,
      'worker-1',
      120,
    ]);
  });

  it('rejects unsafe claim bounds', async () => {
    await expect(
      claimPendingOutboxEvents({ limit: 0, workerId: 'worker-1' }),
    ).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(
      claimPendingOutboxEvents({ limit: 1, workerId: 'worker-1', leaseSeconds: 5 }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      findPendingOutboxEventIds('2026-09-07T00:00:00.000Z', 1, 5),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('lists retryable IDs for a recovery sweep without claiming rows', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'event-1' }, { id: 'event-2' }] });
    await expect(
      findPendingOutboxEventIds('2026-09-07T00:00:00.000Z', 10, 120),
    ).resolves.toEqual(['event-1', 'event-2']);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain("status IN ('pending', 'failed')");
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([
      '2026-09-07T00:00:00.000Z',
      10,
      120,
    ]);
  });

  it('only marks an event when the claiming worker still owns the lease', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [event] });
    await expect(markOutboxEventPublished(event.id, 'worker-1')).resolves.toEqual(event);
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual([event.id, 'worker-1']);

    mockedQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      markOutboxEventFailed({
        id: event.id,
        workerId: 'worker-1',
        error: 'queue unavailable',
        nextAttemptAt: '2026-09-07T00:01:00.000Z',
      }),
    ).resolves.toBeNull();
  });
});
