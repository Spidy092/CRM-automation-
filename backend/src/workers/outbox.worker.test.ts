jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({})),
  OUTBOX_QUEUE: 'event-outbox',
  OUTBOX_PUBLISH: 'outbox:publish',
  enqueueOutboxPublish: jest.fn(),
  enqueueLeadEvent: jest.fn(),
}));

jest.mock('../shared/events/outbox.repository', () => ({
  claimOutboxEventById: jest.fn(),
  findPendingOutboxEventIds: jest.fn(),
  markOutboxEventFailed: jest.fn(),
  markOutboxEventPublished: jest.fn(),
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsFailed: jest.fn(),
  incJobsProcessed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../lib/dlq', () => ({ moveToDLQ: jest.fn() }));

import { enqueueLeadEvent, enqueueOutboxPublish } from './queue';
import {
  claimOutboxEventById,
  findPendingOutboxEventIds,
  markOutboxEventFailed,
  markOutboxEventPublished,
} from '../shared/events/outbox.repository';
import { publishOutboxEvent, startOutboxWorker, sweepPendingOutboxEvents } from './outbox.worker';

const mockClaim = claimOutboxEventById as jest.Mock;
const mockPublish = markOutboxEventPublished as jest.Mock;
const mockFail = markOutboxEventFailed as jest.Mock;
const mockEnqueue = enqueueLeadEvent as jest.Mock;
const mockFindPending = findPendingOutboxEventIds as jest.Mock;
const mockEnqueueOutbox = enqueueOutboxPublish as jest.Mock;

const row = {
  id: 'outbox-1',
  event_type: 'lead.created',
  aggregate_type: 'lead',
  aggregate_id: 'lead-1',
  idempotency_key: 'lead.created:lead-1:event-1',
  payload: { source: 'form' },
  status: 'publishing',
  attempts: 1,
  next_attempt_at: '2026-09-07T00:00:00.000Z',
  locked_at: '2026-09-07T00:00:00.000Z',
  locked_by: 'outbox-worker',
  published_at: null,
  last_error: null,
  created_at: '2026-09-07T00:00:00.000Z',
  updated_at: '2026-09-07T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClaim.mockResolvedValue({ ...row });
  mockPublish.mockResolvedValue({ ...row, status: 'published' });
  mockFail.mockResolvedValue({ ...row, status: 'failed' });
  mockFindPending.mockResolvedValue([]);
});

describe('outbox worker', () => {
  it('publishes a lead event with the outbox ID as its stable event ID', async () => {
    await expect(publishOutboxEvent('outbox-1', 'worker-1')).resolves.toEqual({
      status: 'published',
    });
    expect(mockEnqueue).toHaveBeenCalledWith({
      event: 'lead.created',
      leadId: 'lead-1',
      payload: { source: 'form' },
      eventId: 'outbox-1',
    });
    expect(mockPublish).toHaveBeenCalledWith('outbox-1', 'worker-1');
  });

  it('marks unsupported or malformed events failed and lets BullMQ retry', async () => {
    mockClaim.mockResolvedValue({ ...row, event_type: 'invoice.created' });
    await expect(publishOutboxEvent('outbox-1', 'worker-1')).rejects.toThrow(
      "Unsupported outbox event type 'invoice.created'",
    );
    expect(mockFail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'outbox-1', workerId: 'worker-1' }),
    );
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('starts a BullMQ worker with the outbox queue', () => {
    expect(() => startOutboxWorker()).not.toThrow();
  });

  it('sweeps retryable rows and tolerates one enqueue failure', async () => {
    mockFindPending.mockResolvedValue(['outbox-1', 'outbox-2']);
    mockEnqueueOutbox
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(sweepPendingOutboxEvents(10)).resolves.toBe(1);
    expect(mockFindPending).toHaveBeenCalledWith(expect.any(String), 10);
    expect(mockEnqueueOutbox).toHaveBeenNthCalledWith(
      1,
      { outboxEventId: 'outbox-1' },
      { jobIdSuffix: expect.stringMatching(/^recovery-/) },
    );
    expect(mockEnqueueOutbox).toHaveBeenNthCalledWith(
      2,
      { outboxEventId: 'outbox-2' },
      { jobIdSuffix: expect.stringMatching(/^recovery-/) },
    );
  });
});
