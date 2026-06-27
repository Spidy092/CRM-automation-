/**
 * AI Decision worker tests.
 *
 * Tests:
 *   - handleAiDecisionJob: success path
 *   - handleAiDecisionJob: passes force + context
 *   - handleAiDecisionJob: failure propagation + metrics
 *   - startAiDecisionWorker: failed event fires Sentry.captureException + DLQ at attemptsMade >= attempts
 *   - startAiDecisionWorker: failed event does NOT fire DLQ when attemptsMade < attempts
 *   - startAiDecisionWorker: handles missing job gracefully
 */

import type { Job } from 'bullmq';
import { startAiDecisionWorker, handleAiDecisionJob, type AiDecisionJobData } from './aiDecision.worker';
import { AI_DECISION_QUEUE, AI_DECISION_LEAD } from './queue';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue, processor, _opts) => {
    (global as any).__lastProcessor = processor;
    (global as any).__lastWorkerOptions = _opts;
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
  AI_DECISION_QUEUE: 'ai-decisions',
  AI_DECISION_LEAD: 'ai:next-action',
  aiDecisionQueue: { add: jest.fn() },
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
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

jest.mock('../modules/ai-intelligence/ai-intelligence.service', () => ({
  computeNextBestAction: jest.fn(),
}));

import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';
import { moveToDLQ } from '../lib/dlq';
import { computeNextBestAction } from '../modules/ai-intelligence/ai-intelligence.service';

const mockedComputeNextBestAction = computeNextBestAction as jest.MockedFunction<typeof computeNextBestAction>;
const mockedIncJobsProcessed = incJobsProcessed as jest.Mock;
const mockedIncJobsFailed = incJobsFailed as jest.Mock;
const mockedObserveJobDuration = observeJobDuration as jest.Mock;
const mockedLoggerInfo = logger.info as jest.Mock;
const mockedCaptureException = Sentry.captureException as jest.Mock;
const mockedMoveToDLQ = moveToDLQ as jest.Mock;

function makeJob(overrides: Partial<Job<AiDecisionJobData>> = {}): Job<AiDecisionJobData> {
  return {
    id: 'job-1',
    name: AI_DECISION_LEAD,
    data: {
      leadId: 'lead-1',
      force: false,
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job<AiDecisionJobData>;
}

describe('handleAiDecisionJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('computes next best action, emits metrics, and returns the decision', async () => {
    mockedComputeNextBestAction.mockResolvedValue({
      action: 'call',
      reason: 'High buying intent',
      confidence: 0.92,
    });
    const job = makeJob();

    const result = await handleAiDecisionJob(job);

    expect(mockedComputeNextBestAction).toHaveBeenCalledWith('lead-1', { force: false, context: undefined });
    expect(mockedObserveJobDuration).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_DECISION_LEAD, queue: AI_DECISION_QUEUE }),
      expect.any(Number),
    );
    expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_DECISION_LEAD, queue: AI_DECISION_QUEUE, status: 'success' }),
    );
    expect(result).toEqual({ action: 'call', reason: 'High buying intent', confidence: 0.92 });
  });

  it('passes force=true and context when job data includes them', async () => {
    mockedComputeNextBestAction.mockResolvedValue({
      action: 'email',
      reason: ' nurture sequence',
      confidence: 0.85,
    });
    const context = { lastTouch: 'webinar' };
    const job = makeJob({ data: { leadId: 'lead-1', force: true, context } });

    await handleAiDecisionJob(job);

    expect(mockedComputeNextBestAction).toHaveBeenCalledWith('lead-1', { force: true, context });
  });

  it('propagates errors from computeNextBestAction, emits failure metrics, so BullMQ can retry', async () => {
    const err = new Error('decision service down');
    mockedComputeNextBestAction.mockRejectedValue(err);
    const job = makeJob();

    await expect(handleAiDecisionJob(job)).rejects.toThrow('decision service down');
    expect(mockedIncJobsFailed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_DECISION_LEAD, queue: AI_DECISION_QUEUE }),
    );
  });
});

describe('startAiDecisionWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a worker with concurrency 3 and retention limits', () => {
    expect(() => startAiDecisionWorker()).not.toThrow();
    expect((global as any).__lastWorkerOptions).toMatchObject({
      concurrency: 3,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    });
  });

  it('logs a ready event when the worker emits ready', () => {
    const worker = startAiDecisionWorker();
    const onReady = (worker as any).__on_ready;
    if (onReady) {
      onReady();
    } else {
      throw new Error('ready handler not registered');
    }

    expect(mockedLoggerInfo).toHaveBeenCalledWith(
      'ai decision worker ready',
      expect.objectContaining({ queue: AI_DECISION_QUEUE }),
    );
  });

  describe('failed event handler', () => {
    function triggerFailed(job: any, err: Error) {
      const worker = startAiDecisionWorker();
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

    it('does NOT double-count incJobsFailed because the processor already emitted it', () => {
      const job = makeJob({ attemptsMade: 1 });
      const err = new Error('first failure');
      triggerFailed(job, err);

      expect(mockedIncJobsFailed).not.toHaveBeenCalled();
    });

    it('moves job to DLQ when attemptsMade >= attempts', () => {
      const job = makeJob({ id: 'job-dlq', attemptsMade: 3, opts: { attempts: 3 } });
      const err = new Error('final attempt failed');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_DECISION_QUEUE,
        expect.objectContaining({
          id: 'job-dlq',
          name: AI_DECISION_LEAD,
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
      const job = { id: 'job-default', name: AI_DECISION_LEAD, data: {}, attemptsMade: 3, opts: {} } as any;
      const err = new Error('default attempts reached');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_DECISION_QUEUE,
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
