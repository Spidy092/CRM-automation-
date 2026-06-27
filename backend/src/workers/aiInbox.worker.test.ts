/**
 * AI Inbox worker tests.
 *
 * Tests:
 *   - handleAiInboxJob: expiry-sweep path
 *   - handleAiInboxJob: create-item path (success)
 *   - handleAiInboxJob: create-item with expiresInHours > 0
 *   - handleAiInboxJob: create-item throws → propagates error
 *   - startAiInboxWorker: failed event fires Sentry.captureException + DLQ at attemptsMade >= attempts
 *   - startAiInboxWorker: failed event does NOT fire DLQ when attemptsMade < attempts
 */

import type { Job } from 'bullmq';
import {
  startAiInboxWorker,
  handleAiInboxJob,
} from './aiInbox.worker';
import {
  AI_INBOX_QUEUE,
  AI_CREATE_INBOX_ITEM,
  type AiCreateInboxItemJob,
} from './queue';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue, processor, _opts) => {
    (global as any).__lastProcessor = processor;
    (global as any).__lastWorkerInstance = {
      on: jest.fn((event, handler) => {
        (global as any).__lastWorkerInstance[`__on_${event}`] = handler;
        return (global as any).__lastWorkerInstance;
      }),
    };
    return (global as any).__lastWorkerInstance;
  }),
}));

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  AI_INBOX_QUEUE: 'ai:inbox',
  AI_CREATE_INBOX_ITEM: 'ai:create-inbox-item',
  aiInboxQueue: { add: jest.fn() },
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../lib/dlq', () => ({
  moveToDLQ: jest.fn(),
}));

jest.mock('../modules/ai-inbox/ai-inbox.service', () => ({
  createItem: jest.fn(),
  runExpirySweep: jest.fn(),
}));

import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';
import { moveToDLQ } from '../lib/dlq';
import { createItem, runExpirySweep } from '../modules/ai-inbox/ai-inbox.service';
import { logger } from '../shared/utils/logger';

const mockedCreateItem = createItem as jest.MockedFunction<typeof createItem>;
const mockedRunExpirySweep = runExpirySweep as jest.MockedFunction<typeof runExpirySweep>;
const mockedIncJobsProcessed = incJobsProcessed as jest.Mock;
const mockedIncJobsFailed = incJobsFailed as jest.Mock;
const mockedObserveJobDuration = observeJobDuration as jest.Mock;
const mockedCaptureException = Sentry.captureException as jest.Mock;
const mockedMoveToDLQ = moveToDLQ as jest.Mock;

function makeJob(overrides: Partial<Job<AiCreateInboxItemJob>> = {}): Job<AiCreateInboxItemJob> {
  return {
    id: 'job-1',
    name: AI_CREATE_INBOX_ITEM,
    data: {
      assignedTo: 'u-1',
      leadId: 'lead-1',
      campaignId: 'camp-1',
      itemType: 'approve_response',
      title: 'Test',
      summary: 'Sum',
      urgencyScore: 80,
      aiDraftResponse: 'Draft',
      aiDraftConfidence: 0.9,
      expiresInHours: undefined,
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job<AiCreateInboxItemJob>;
}

describe('handleAiInboxJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('expiry sweep path', () => {
    it('calls runExpirySweep, emits metrics, and returns { swept }', async () => {
      mockedRunExpirySweep.mockResolvedValue(5);
      const job = makeJob({ name: 'ai:expiry-sweep', data: {} as any });

      const result = await handleAiInboxJob(job);

      expect(mockedRunExpirySweep).toHaveBeenCalledTimes(1);
      expect(mockedObserveJobDuration).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ai:expiry-sweep', queue: AI_INBOX_QUEUE }),
        expect.any(Number),
      );
      expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ai:expiry-sweep', queue: AI_INBOX_QUEUE, status: 'success' }),
      );
      expect(result).toEqual({ swept: 5 });
    });

    it('returns { swept: 0 } when sweep finds nothing', async () => {
      mockedRunExpirySweep.mockResolvedValue(0);
      const job = makeJob({ name: 'ai:expiry-sweep', data: {} as any });

      const result = await handleAiInboxJob(job);

      expect(result).toEqual({ swept: 0 });
    });
  });

  describe('create-item path (success)', () => {
    it('creates item, emits metrics, returns { itemId }', async () => {
      mockedCreateItem.mockResolvedValue({ id: 'item-99' } as any);
      const job = makeJob();

      const result = await handleAiInboxJob(job);

      expect(mockedCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          assigned_to: 'u-1',
          lead_id: 'lead-1',
          campaign_id: 'camp-1',
          item_type: 'approve_response',
        }),
      );
      expect(mockedObserveJobDuration).toHaveBeenCalledWith(
        expect.objectContaining({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE }),
        expect.any(Number),
      );
      expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE, status: 'success' }),
      );
      expect(result).toEqual({ itemId: 'item-99' });
    });

    it('passes expires_at when expiresInHours > 0', async () => {
      mockedCreateItem.mockResolvedValue({ id: 'item-100' } as any);
      const job = makeJob({ data: { ...makeJob().data, expiresInHours: 24 } });

      await handleAiInboxJob(job);

      expect(mockedCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          expires_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
        }),
      );
    });

    it('omits expires_at when expiresInHours is 0 or undefined', async () => {
      mockedCreateItem.mockResolvedValue({ id: 'item-101' } as any);
      const job = makeJob({ data: { ...makeJob().data, expiresInHours: 0 } });

      await handleAiInboxJob(job);

      expect(mockedCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({ expires_at: undefined }),
      );
    });
  });

  describe('create-item path (failure)', () => {
    it('propagates errors from createItem so BullMQ can retry', async () => {
      const err = new Error('DB write failed');
      mockedCreateItem.mockRejectedValue(err);
      const job = makeJob();

      await expect(handleAiInboxJob(job)).rejects.toThrow('DB write failed');
    });
  });
});

describe('startAiInboxWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a worker without throwing', () => {
    expect(() => startAiInboxWorker()).not.toThrow();
  });

  describe('failed event handler', () => {
    function triggerFailed(job: any, err: Error) {
      const worker = startAiInboxWorker();
      // The mock Worker captured the on() handler; retrieve it
      const onFailed = (worker as any).__on_failed;
      if (onFailed) {
        onFailed(job, err);
      } else {
        throw new Error('failed handler not registered');
      }
    }

    it('calls Sentry.captureException with the error and jobId extra', () => {
      const job = makeJob({ id: 'job-fail-1', attemptsMade: 1, opts: { attempts: 3 } });
      const err = new Error('boom');
      triggerFailed(job, err);

      expect(mockedCaptureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ extra: expect.objectContaining({ jobId: 'job-fail-1' }) }),
      );
    });

    it('calls incJobsFailed on any failure', () => {
      const job = makeJob({ attemptsMade: 1 });
      const err = new Error('first failure');
      triggerFailed(job, err);

      expect(mockedIncJobsFailed).toHaveBeenCalledWith(
        expect.objectContaining({ name: AI_CREATE_INBOX_ITEM, queue: AI_INBOX_QUEUE }),
      );
    });

    it('moves job to DLQ when attemptsMade >= attempts', () => {
      const job = makeJob({ id: 'job-dlq', attemptsMade: 3, opts: { attempts: 3 } });
      const err = new Error('final attempt failed');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_INBOX_QUEUE,
        expect.objectContaining({
          id: 'job-dlq',
          name: AI_CREATE_INBOX_ITEM,
          failedReason: 'final attempt failed',
          attemptsMade: 3,
        }),
      );
    });

    it('does NOT move to DLQ when attemptsMade < attempts (BullMQ will retry)', () => {
      const job = makeJob({ id: 'job-retry', attemptsMade: 1, opts: { attempts: 3 } });
      const err = new Error('transient failure');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).not.toHaveBeenCalled();
    });

    it('defaults attempts to 3 when job.opts.attempts is missing', () => {
      const job = { id: 'job-default', name: AI_CREATE_INBOX_ITEM, data: {}, attemptsMade: 3, opts: {} } as any;
      const err = new Error('default attempts reached');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_INBOX_QUEUE,
        expect.objectContaining({ id: 'job-default', attemptsMade: 3 }),
      );
    });

    it('handles a missing job (job is undefined) gracefully', () => {
      const err = new Error('orphan failure');
      // Should not throw; Sentry still gets the call
      expect(() => triggerFailed(undefined as any, err)).not.toThrow();
      expect(mockedCaptureException).toHaveBeenCalledWith(err, expect.any(Object));
    });
  });
});
