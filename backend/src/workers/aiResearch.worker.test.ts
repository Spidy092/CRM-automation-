/**
 * AI Research worker tests.
 *
 * Tests:
 *   - handleAiResearchJob: success path
 *   - handleAiResearchJob: failure propagation + metrics
 *   - startAiResearchWorker: failed event fires Sentry.captureException + DLQ at attemptsMade >= attempts
 *   - startAiResearchWorker: failed event does NOT fire DLQ when attemptsMade < attempts
 *   - startAiResearchWorker: handles missing job gracefully
 */

import type { Job } from 'bullmq';
import { startAiResearchWorker, handleAiResearchJob } from './aiResearch.worker';
import { AI_RESEARCH_QUEUE, AI_RESEARCH_LEAD, type AiResearchLeadJob } from './queue';

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
  AI_RESEARCH_QUEUE: 'ai-research',
  AI_RESEARCH_LEAD: 'ai:research-lead',
  aiResearchQueue: { add: jest.fn() },
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
  observeAiResearchDuration: jest.fn(),
  incAiResearch: jest.fn(),
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../lib/dlq', () => ({
  moveToDLQ: jest.fn(),
}));

jest.mock('../modules/ai-intelligence/ai-intelligence.service', () => ({
  researchLead: jest.fn(),
}));

import {
  incJobsProcessed,
  incJobsFailed,
  observeJobDuration,
  observeAiResearchDuration,
  incAiResearch,
} from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';
import { moveToDLQ } from '../lib/dlq';
import { researchLead } from '../modules/ai-intelligence/ai-intelligence.service';

const mockedResearchLead = researchLead as jest.MockedFunction<typeof researchLead>;
const mockedIncJobsProcessed = incJobsProcessed as jest.Mock;
const mockedIncJobsFailed = incJobsFailed as jest.Mock;
const mockedObserveJobDuration = observeJobDuration as jest.Mock;
const mockedObserveAiResearchDuration = observeAiResearchDuration as jest.Mock;
const mockedIncAiResearch = incAiResearch as jest.Mock;
const mockedCaptureException = Sentry.captureException as jest.Mock;
const mockedMoveToDLQ = moveToDLQ as jest.Mock;

function makeJob(overrides: Partial<Job<AiResearchLeadJob>> = {}): Job<AiResearchLeadJob> {
  return {
    id: 'job-1',
    name: AI_RESEARCH_LEAD,
    data: {
      leadId: 'lead-1',
      force: false,
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job<AiResearchLeadJob>;
}

describe('handleAiResearchJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('researches lead, emits metrics, and returns the expected shape', async () => {
    mockedResearchLead.mockResolvedValue({
      enrichment_status: 'complete',
      buying_intent: 'high',
      next_best_action: 'call',
    } as any);
    const job = makeJob();

    const result = await handleAiResearchJob(job);

    expect(mockedResearchLead).toHaveBeenCalledWith('lead-1', false);
    expect(mockedObserveJobDuration).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_RESEARCH_LEAD, queue: AI_RESEARCH_QUEUE }),
      expect.any(Number),
    );
    expect(mockedObserveAiResearchDuration).toHaveBeenCalledWith(expect.any(Number));
    expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_RESEARCH_LEAD, queue: AI_RESEARCH_QUEUE, status: 'success' }),
    );
    expect(mockedIncAiResearch).toHaveBeenCalledWith('success');
    expect(result).toEqual({
      leadId: 'lead-1',
      enrichment_status: 'complete',
      buying_intent: 'high',
      next_best_action: 'call',
    });
  });

  it('passes force=true when job data includes it', async () => {
    mockedResearchLead.mockResolvedValue({
      enrichment_status: 'complete',
      buying_intent: 'medium',
      next_best_action: 'email',
    } as any);
    const job = makeJob({ data: { leadId: 'lead-1', force: true } });

    await handleAiResearchJob(job);

    expect(mockedResearchLead).toHaveBeenCalledWith('lead-1', true);
  });

  it('propagates errors from researchLead, emits failure metrics, so BullMQ can retry', async () => {
    const err = new Error('research service down');
    mockedResearchLead.mockRejectedValue(err);
    const job = makeJob();

    await expect(handleAiResearchJob(job)).rejects.toThrow('research service down');
    expect(mockedIncJobsFailed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_RESEARCH_LEAD, queue: AI_RESEARCH_QUEUE }),
    );
    expect(mockedIncAiResearch).toHaveBeenCalledWith('failed');
  });
});

describe('startAiResearchWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a worker without throwing', () => {
    expect(() => startAiResearchWorker()).not.toThrow();
  });

  describe('failed event handler', () => {
    function triggerFailed(job: any, err: Error) {
      const worker = startAiResearchWorker();
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
        AI_RESEARCH_QUEUE,
        expect.objectContaining({
          id: 'job-dlq',
          name: AI_RESEARCH_LEAD,
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
      const job = { id: 'job-default', name: AI_RESEARCH_LEAD, data: {}, attemptsMade: 3, opts: {} } as any;
      const err = new Error('default attempts reached');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_RESEARCH_QUEUE,
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
