/**
 * AI Reply worker tests.
 *
 * Tests:
 *   - handleAiReplyJob: success path
 *   - handleAiReplyJob: failure propagation
 *   - startAiReplyWorker: failed event fires Sentry.captureException + DLQ at attemptsMade >= attempts
 *   - startAiReplyWorker: failed event does NOT fire DLQ when attemptsMade < attempts
 *   - startAiReplyWorker: handles missing job gracefully
 */

import type { Job } from 'bullmq';
import { startAiReplyWorker, handleAiReplyJob } from './aiReply.worker';
import { AI_REPLY_QUEUE, AI_CLASSIFY_REPLY, type AiClassifyReplyJob } from './queue';

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
  AI_REPLY_QUEUE: 'ai-reply',
  AI_CLASSIFY_REPLY: 'ai:classify-reply',
  aiReplyQueue: { add: jest.fn() },
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

jest.mock('../modules/ai-reply/ai-reply.service', () => ({
  classifyReply: jest.fn(),
}));

import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';
import { moveToDLQ } from '../lib/dlq';
import { classifyReply } from '../modules/ai-reply/ai-reply.service';

const mockedClassifyReply = classifyReply as jest.MockedFunction<typeof classifyReply>;
const mockedIncJobsProcessed = incJobsProcessed as jest.Mock;
const mockedIncJobsFailed = incJobsFailed as jest.Mock;
const mockedObserveJobDuration = observeJobDuration as jest.Mock;
const mockedCaptureException = Sentry.captureException as jest.Mock;
const mockedMoveToDLQ = moveToDLQ as jest.Mock;

function makeJob(overrides: Partial<Job<AiClassifyReplyJob>> = {}): Job<AiClassifyReplyJob> {
  return {
    id: 'job-1',
    name: AI_CLASSIFY_REPLY,
    data: {
      leadId: 'lead-1',
      channel: 'email',
      messageText: 'Hello',
      externalMessageId: 'ext-1',
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job<AiClassifyReplyJob>;
}

describe('handleAiReplyJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies reply, emits metrics, and returns the expected shape', async () => {
    mockedClassifyReply.mockResolvedValue({
      intent_class: 'interested',
      intent_subtype: 'high',
      confidence: 0.95,
      draft_response: null,
      next_best_action: 'schedule_call',
      update_stage_to: null,
      objection_type: null,
      buying_signal: 'pricing',
      chain_of_thought: 'looks interested',
      should_stop_sequence: false,
      requires_human_review: false,
    } as any);
    const job = makeJob();

    const result = await handleAiReplyJob(job);

    expect(mockedClassifyReply).toHaveBeenCalledWith({
      leadId: 'lead-1',
      channel: 'email',
      messageText: 'Hello',
      externalMessageId: 'ext-1',
    });
    expect(mockedObserveJobDuration).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE }),
      expect.any(Number),
    );
    expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE, status: 'success' }),
    );
    expect(result).toEqual({
      leadId: 'lead-1',
      intent_class: 'interested',
      confidence: 0.95,
      requires_human_review: false,
    });
  });

  it('propagates errors from classifyReply so BullMQ can retry', async () => {
    const err = new Error('classifier down');
    mockedClassifyReply.mockRejectedValue(err);
    const job = makeJob();

    await expect(handleAiReplyJob(job)).rejects.toThrow('classifier down');
  });
});

describe('startAiReplyWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a worker without throwing', () => {
    expect(() => startAiReplyWorker()).not.toThrow();
  });

  describe('failed event handler', () => {
    function triggerFailed(job: any, err: Error) {
      const worker = startAiReplyWorker();
      const onFailed = (worker as any).__on_failed;
      if (onFailed) {
        onFailed(job, err);
      } else {
        throw new Error('failed handler not registered');
      }
    }

    it('calls Sentry.captureException with the error and jobId + leadId extras', () => {
      const job = makeJob({ id: 'job-fail-1', attemptsMade: 1, opts: { attempts: 3 } });
      const err = new Error('boom');
      triggerFailed(job, err);

      expect(mockedCaptureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          extra: expect.objectContaining({ jobId: 'job-fail-1', leadId: 'lead-1' }),
        }),
      );
    });

    it('calls incJobsFailed on any failure', () => {
      const job = makeJob({ attemptsMade: 1 });
      const err = new Error('first failure');
      triggerFailed(job, err);

      expect(mockedIncJobsFailed).toHaveBeenCalledWith(
        expect.objectContaining({ name: AI_CLASSIFY_REPLY, queue: AI_REPLY_QUEUE }),
      );
    });

    it('moves job to DLQ when attemptsMade >= attempts', () => {
      const job = makeJob({ id: 'job-dlq', attemptsMade: 3, opts: { attempts: 3 } });
      const err = new Error('final attempt failed');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_REPLY_QUEUE,
        expect.objectContaining({
          id: 'job-dlq',
          name: AI_CLASSIFY_REPLY,
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
      const job = { id: 'job-default', name: AI_CLASSIFY_REPLY, data: {}, attemptsMade: 3, opts: {} } as any;
      const err = new Error('default attempts reached');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_REPLY_QUEUE,
        expect.objectContaining({ id: 'job-default', attemptsMade: 3 }),
      );
    });

    it('handles a missing job (job is undefined) gracefully', () => {
      const err = new Error('orphan failure');
      expect(() => triggerFailed(undefined as any, err)).not.toThrow();
      expect(mockedCaptureException).toHaveBeenCalledWith(err, expect.any(Object));
    });
  });
});
