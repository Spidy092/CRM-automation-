/**
 * AI Campaign Brain worker tests.
 *
 * Tests:
 *   - handleAiCampaignBrainJob: success path
 *   - handleAiCampaignBrainJob: failure propagation
 *   - startAiCampaignBrainWorker: failed event fires Sentry.captureException + DLQ at attemptsMade >= attempts
 *   - startAiCampaignBrainWorker: failed event does NOT fire DLQ when attemptsMade < attempts
 *   - startAiCampaignBrainWorker: handles missing job gracefully
 */

import type { Job } from 'bullmq';
import { startAiCampaignBrainWorker, handleAiCampaignBrainJob } from './aiCampaignBrain.worker';
import { AI_CAMPAIGN_QUEUE, AI_CAMPAIGN_BRIEF, type AiGenerateCampaignBriefJob } from './queue';

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
  AI_CAMPAIGN_QUEUE: 'ai-campaign',
  AI_CAMPAIGN_BRIEF: 'ai:generate-campaign-brief',
  aiCampaignQueue: { add: jest.fn() },
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

jest.mock('../modules/ai-campaign-brain/ai-campaign-brain.service', () => ({
  generateCampaignBrief: jest.fn(),
}));

import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { Sentry } from '../shared/utils/sentry';
import { moveToDLQ } from '../lib/dlq';
import { generateCampaignBrief } from '../modules/ai-campaign-brain/ai-campaign-brain.service';

const mockedGenerateCampaignBrief = generateCampaignBrief as jest.MockedFunction<typeof generateCampaignBrief>;
const mockedIncJobsProcessed = incJobsProcessed as jest.Mock;
const mockedIncJobsFailed = incJobsFailed as jest.Mock;
const mockedObserveJobDuration = observeJobDuration as jest.Mock;
const mockedCaptureException = Sentry.captureException as jest.Mock;
const mockedMoveToDLQ = moveToDLQ as jest.Mock;

function makeJob(overrides: Partial<Job<AiGenerateCampaignBriefJob>> = {}): Job<AiGenerateCampaignBriefJob> {
  return {
    id: 'job-1',
    name: AI_CAMPAIGN_BRIEF,
    data: {
      campaignId: 'camp-1',
      triggeredBy: 'user-1',
    },
    attemptsMade: 0,
    opts: { attempts: 2 },
    ...overrides,
  } as unknown as Job<AiGenerateCampaignBriefJob>;
}

describe('handleAiCampaignBrainJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates brief, emits metrics, and returns the expected shape', async () => {
    mockedGenerateCampaignBrief.mockResolvedValue({
      id: 'brief-99',
      confidence_score: 0.92,
      high_fit_leads: 42,
      recommended_autonomy_level: 'high',
    } as any);
    const job = makeJob();

    const result = await handleAiCampaignBrainJob(job);

    expect(mockedGenerateCampaignBrief).toHaveBeenCalledWith('camp-1', 'user-1');
    expect(mockedObserveJobDuration).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE }),
      expect.any(Number),
    );
    expect(mockedIncJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE, status: 'success' }),
    );
    expect(result).toEqual({
      campaignId: 'camp-1',
      briefId: 'brief-99',
      confidence: 0.92,
      highFitLeads: 42,
    });
  });

  it('propagates errors from generateCampaignBrief so BullMQ can retry', async () => {
    const err = new Error('brain service down');
    mockedGenerateCampaignBrief.mockRejectedValue(err);
    const job = makeJob();

    await expect(handleAiCampaignBrainJob(job)).rejects.toThrow('brain service down');
  });
});

describe('startAiCampaignBrainWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a worker without throwing', () => {
    expect(() => startAiCampaignBrainWorker()).not.toThrow();
  });

  describe('failed event handler', () => {
    function triggerFailed(job: any, err: Error) {
      const worker = startAiCampaignBrainWorker();
      const onFailed = (worker as any).__on_failed;
      if (onFailed) {
        onFailed(job, err);
      } else {
        throw new Error('failed handler not registered');
      }
    }

    it('calls Sentry.captureException with the error and jobId + campaignId extras', () => {
      const job = makeJob({ id: 'job-fail-1', attemptsMade: 1, opts: { attempts: 2 } });
      const err = new Error('boom');
      triggerFailed(job, err);

      expect(mockedCaptureException).toHaveBeenCalledWith(
        err,
        expect.objectContaining({
          extra: expect.objectContaining({ jobId: 'job-fail-1', campaignId: 'camp-1' }),
        }),
      );
    });

    it('calls incJobsFailed on any failure', () => {
      const job = makeJob({ attemptsMade: 1 });
      const err = new Error('first failure');
      triggerFailed(job, err);

      expect(mockedIncJobsFailed).toHaveBeenCalledWith(
        expect.objectContaining({ name: AI_CAMPAIGN_BRIEF, queue: AI_CAMPAIGN_QUEUE }),
      );
    });

    it('moves job to DLQ when attemptsMade >= attempts', () => {
      const job = makeJob({ id: 'job-dlq', attemptsMade: 2, opts: { attempts: 2 } });
      const err = new Error('final attempt failed');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_CAMPAIGN_QUEUE,
        expect.objectContaining({
          id: 'job-dlq',
          name: AI_CAMPAIGN_BRIEF,
          failedReason: 'final attempt failed',
          attemptsMade: 2,
        }),
      );
    });

    it('does NOT move to DLQ when attemptsMade < attempts (BullMQ will retry)', () => {
      const job = makeJob({ id: 'job-retry', attemptsMade: 1, opts: { attempts: 2 } });
      const err = new Error('transient failure');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).not.toHaveBeenCalled();
    });

    it('defaults attempts to 2 when job.opts.attempts is missing', () => {
      const job = { id: 'job-default', name: AI_CAMPAIGN_BRIEF, data: {}, attemptsMade: 2, opts: {} } as any;
      const err = new Error('default attempts reached');
      triggerFailed(job, err);

      expect(mockedMoveToDLQ).toHaveBeenCalledWith(
        AI_CAMPAIGN_QUEUE,
        expect.objectContaining({ id: 'job-default', attemptsMade: 2 }),
      );
    });

    it('handles a missing job (job is undefined) gracefully', () => {
      const err = new Error('orphan failure');
      expect(() => triggerFailed(undefined as any, err)).not.toThrow();
      expect(mockedCaptureException).toHaveBeenCalledWith(err, expect.any(Object));
    });
  });
});
