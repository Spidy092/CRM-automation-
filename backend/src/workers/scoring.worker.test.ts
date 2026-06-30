/**
 * Scoring worker tests.
 *
 * The scoring worker keeps its job processor and event handlers inline in the
 * `new Worker(...)` call (no exported handler functions). To exercise those
 * branches we mock `bullmq` so the Worker constructor captures:
 *   - the processor callback (arg 2)
 *   - every `.on(event, handler)` registration
 * We then drive the captured processor with fake `job` objects and the captured
 * `failed` handler for the DLQ-routing branches. No real Redis/DB/queue is
 * touched — every dependency is mocked.
 */

type Processor = (job: any) => Promise<unknown>;
const captured: {
  processor: Processor | null;
  handlers: Record<string, (...args: any[]) => void>;
} = { processor: null, handlers: {} };

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue: string, processor: Processor) => {
    captured.processor = processor;
    captured.handlers = {};
    return {
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        captured.handlers[event] = handler;
      }),
    };
  }),
}));

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  enqueueAssignment: jest.fn().mockResolvedValue(undefined),
  enqueueLeadEvent: jest.fn().mockResolvedValue(undefined),
  SCORING_QUEUE: 'scoring',
  SCORING_CALCULATE_LEAD: 'scoring:calculate-lead',
  SCORING_RECALCULATE_ALL: 'scoring:recalculate-all',
  ASSIGNMENT_ROUND_ROBIN: 'assignment:round-robin',
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../lib/dlq', () => ({
  moveToDLQ: jest.fn(),
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../modules/scoring/scoring.repository', () => ({
  findScoringConfig: jest.fn(),
}));

jest.mock('../modules/scoring/scoring.service', () => ({
  calculateLeadScore: jest.fn(),
}));

// The recalculate-all handler dynamically imports the db pool.
const mockQuery = jest.fn();
jest.mock('../shared/utils/db', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { startScoringWorker } from './scoring.worker';
import { enqueueAssignment, enqueueLeadEvent } from './queue';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { logger } from '../shared/utils/logger';
import { findScoringConfig } from '../modules/scoring/scoring.repository';
import { calculateLeadScore } from '../modules/scoring/scoring.service';

const SCORING_CALCULATE_LEAD = 'scoring:calculate-lead';
const SCORING_RECALCULATE_ALL = 'scoring:recalculate-all';

function makeJob(over: Partial<any> = {}): any {
  return {
    id: 'job-1',
    name: SCORING_CALCULATE_LEAD,
    data: {},
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...over,
  };
}

function leadScore(over: Partial<any> = {}): any {
  return {
    lead_id: 'lead1',
    score: 80,
    classification: 'hot',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  captured.processor = null;
  captured.handlers = {};
  startScoringWorker();
});

describe('startScoringWorker', () => {
  it('starts without error and registers ready + failed handlers', () => {
    expect(captured.processor).toBeInstanceOf(Function);
    expect(captured.handlers.ready).toBeInstanceOf(Function);
    expect(captured.handlers.failed).toBeInstanceOf(Function);
    // exercise the ready handler (logs only)
    expect(() => captured.handlers.ready()).not.toThrow();
  });
});

describe('processor — scoring:calculate-lead', () => {
  it('computes score, enqueues assignment for hot lead above threshold', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(leadScore({ score: 85 }));
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } }),
    );

    expect(calculateLeadScore).toHaveBeenCalledWith('lead1');
    expect(enqueueAssignment).toHaveBeenCalledWith({
      leadId: 'lead1',
      score: 85,
      classification: 'hot',
    });
    expect(result).toMatchObject({
      leadId: 'lead1',
      score: 85,
      classification: 'hot',
      enqueuedAssignment: true,
    });
    expect(observeJobDuration).toHaveBeenCalled();
    expect(incJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('uses default threshold (70) when config is null', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(leadScore({ score: 70 }));
    (findScoringConfig as jest.Mock).mockResolvedValue(null);

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } }),
    );

    expect(enqueueAssignment).toHaveBeenCalled();
    expect((result as any).enqueuedAssignment).toBe(true);
  });

  it('does not enqueue when hot but below threshold', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(leadScore({ score: 50 }));
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } }),
    );

    expect(enqueueAssignment).not.toHaveBeenCalled();
    expect((result as any).enqueuedAssignment).toBe(false);
  });

  it('does not enqueue when classification is not hot', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(
      leadScore({ score: 90, classification: 'warm' }),
    );

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } }),
    );

    expect(findScoringConfig).not.toHaveBeenCalled();
    expect(enqueueAssignment).not.toHaveBeenCalled();
    expect((result as any).enqueuedAssignment).toBe(false);
  });
});

describe('processor — scoring:calculate-lead → ai decision queue wiring', () => {
  it('emits a lead.scored event for every successful scoring run (hot)', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(leadScore({ score: 85 }));
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });

    await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } }),
    );

    expect(enqueueLeadEvent).toHaveBeenCalledTimes(1);
    expect(enqueueLeadEvent).toHaveBeenCalledWith({
      event: 'lead.scored',
      leadId: 'lead1',
      payload: { score: 85, classification: 'hot' },
    });
  });

  it('emits a lead.scored event even for cold/warm leads (ai decisions still apply)', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(
      leadScore({ score: 30, classification: 'cold', lead_id: 'lead2' }),
    );

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead2' } }),
    );

    expect(enqueueLeadEvent).toHaveBeenCalledWith({
      event: 'lead.scored',
      leadId: 'lead2',
      payload: { score: 30, classification: 'cold' },
    });
    expect(result).toMatchObject({
      leadId: 'lead2',
      score: 30,
      classification: 'cold',
    });
  });

  it('does not throw if enqueueLeadEvent rejects — scoring still returns', async () => {
    (calculateLeadScore as jest.Mock).mockResolvedValue(leadScore({ score: 50, lead_id: 'lead3' }));
    (enqueueLeadEvent as jest.Mock).mockRejectedValue(new Error('redis down'));

    const result = await captured.processor!(
      makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead3' } }),
    );

    expect(result).toMatchObject({
      leadId: 'lead3',
      score: 50,
      classification: 'hot',
      enqueuedAssignment: false,
    });
    // Let the queued microtask run so the .catch handler is exercised and the
    // rejection is consumed before jest tears the test down.
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.warn).toHaveBeenCalledWith(
      'failed to enqueue lead.scored event for ai decision queue',
      expect.objectContaining({ leadId: 'lead3', error: 'redis down' }),
    );
  });

  it('does NOT emit lead.scored when scoring itself fails', async () => {
    (calculateLeadScore as jest.Mock).mockRejectedValue(new Error('service down'));

    await expect(
      captured.processor!(
        makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead4' } }),
      ),
    ).rejects.toThrow('service down');

    expect(enqueueLeadEvent).not.toHaveBeenCalled();
  });
});

describe('processor — scoring:recalculate-all', () => {
  it('recomputes all leads and enqueues qualifying hot leads', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'a', lead_score: 10, classification: 'cold' },
        { id: 'b', lead_score: 90, classification: 'hot' },
      ],
    });
    (calculateLeadScore as jest.Mock)
      .mockResolvedValueOnce(leadScore({ lead_id: 'a', score: 20, classification: 'warm' }))
      .mockResolvedValueOnce(leadScore({ lead_id: 'b', score: 90, classification: 'hot' }));

    const result = await captured.processor!(
      makeJob({ name: SCORING_RECALCULATE_ALL, data: {} }),
    );

    expect(result).toEqual({ processed: 2, enqueued: 1 });
    expect(enqueueAssignment).toHaveBeenCalledTimes(1);
    expect(enqueueAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'b', score: 90 }),
    );
  });

  it('continues past a per-lead failure and still processes others', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue(null); // default threshold path
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'a', lead_score: 10, classification: 'cold' },
        { id: 'b', lead_score: 90, classification: 'hot' },
      ],
    });
    (calculateLeadScore as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(leadScore({ lead_id: 'b', score: 90, classification: 'hot' }));

    const result = await captured.processor!(
      makeJob({ name: SCORING_RECALCULATE_ALL, data: {} }),
    );

    expect(result).toEqual({ processed: 1, enqueued: 1 });
  });

  it('handles a non-Error thrown value in the per-lead loop', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });
    mockQuery.mockResolvedValue({ rows: [{ id: 'a', lead_score: 0, classification: null }] });
    (calculateLeadScore as jest.Mock).mockRejectedValueOnce('string-error');

    const result = await captured.processor!(
      makeJob({ name: SCORING_RECALCULATE_ALL, data: {} }),
    );

    expect(result).toEqual({ processed: 0, enqueued: 0 });
  });

  it('emits a lead.scored event for every recalculated lead (cold, warm, hot)', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'a', lead_score: 10, classification: 'cold' },
        { id: 'b', lead_score: 90, classification: 'hot' },
        { id: 'c', lead_score: 50, classification: 'warm' },
      ],
    });
    (calculateLeadScore as jest.Mock)
      .mockResolvedValueOnce(leadScore({ lead_id: 'a', score: 20, classification: 'warm' }))
      .mockResolvedValueOnce(leadScore({ lead_id: 'b', score: 90, classification: 'hot' }))
      .mockResolvedValueOnce(leadScore({ lead_id: 'c', score: 50, classification: 'warm' }));

    await captured.processor!(
      makeJob({ name: SCORING_RECALCULATE_ALL, data: {} }),
    );

    expect(enqueueLeadEvent).toHaveBeenCalledTimes(3);
    expect(enqueueLeadEvent).toHaveBeenNthCalledWith(1, {
      event: 'lead.scored',
      leadId: 'a',
      payload: { score: 20, classification: 'warm' },
    });
    expect(enqueueLeadEvent).toHaveBeenNthCalledWith(2, {
      event: 'lead.scored',
      leadId: 'b',
      payload: { score: 90, classification: 'hot' },
    });
    expect(enqueueLeadEvent).toHaveBeenNthCalledWith(3, {
      event: 'lead.scored',
      leadId: 'c',
      payload: { score: 50, classification: 'warm' },
    });
  });

  it('keeps processing remaining leads when enqueueLeadEvent rejects for one', async () => {
    (findScoringConfig as jest.Mock).mockResolvedValue({ assignment_threshold: 70 });
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'a', lead_score: 10, classification: 'cold' },
        { id: 'b', lead_score: 90, classification: 'hot' },
      ],
    });
    (calculateLeadScore as jest.Mock)
      .mockResolvedValueOnce(leadScore({ lead_id: 'a', score: 20, classification: 'warm' }))
      .mockResolvedValueOnce(leadScore({ lead_id: 'b', score: 90, classification: 'hot' }));
    (enqueueLeadEvent as jest.Mock)
      .mockRejectedValueOnce(new Error('redis hiccup'))
      .mockResolvedValueOnce(undefined);

    const result = await captured.processor!(
      makeJob({ name: SCORING_RECALCULATE_ALL, data: {} }),
    );

    expect(result).toEqual({ processed: 2, enqueued: 1 });
    expect(enqueueLeadEvent).toHaveBeenCalledTimes(2);
    // Drain queued rejections so the .catch handler runs and the unhandled
    // rejection is consumed before jest tears the test down.
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe('processor — error handling', () => {
  it('throws and increments failed counter for unknown job name', async () => {
    await expect(
      captured.processor!(makeJob({ name: 'scoring:bogus', data: {} })),
    ).rejects.toThrow('Unknown scoring job: scoring:bogus');
    expect(incJobsFailed).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'scoring:bogus' }),
    );
  });

  it('rethrows service errors and increments failed counter', async () => {
    (calculateLeadScore as jest.Mock).mockRejectedValue(new Error('service down'));

    await expect(
      captured.processor!(makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } })),
    ).rejects.toThrow('service down');
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('handles a non-Error thrown value in the processor catch block', async () => {
    (calculateLeadScore as jest.Mock).mockRejectedValue('plain string');

    await expect(
      captured.processor!(makeJob({ name: SCORING_CALCULATE_LEAD, data: { leadId: 'lead1' } })),
    ).rejects.toBe('plain string');
    expect(incJobsFailed).toHaveBeenCalled();
  });
});

describe('failed handler — DLQ routing', () => {
  it('moves to DLQ on the final attempt', () => {
    const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
    captured.handlers.failed(job, new Error('final fail'));

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(moveToDLQ).toHaveBeenCalledWith(
      'scoring',
      expect.objectContaining({ id: 'job-1', failedReason: 'final fail', attemptsMade: 3 }),
    );
  });

  it('does NOT move to DLQ when retries remain', () => {
    const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
    captured.handlers.failed(job, new Error('retry me'));

    expect(moveToDLQ).not.toHaveBeenCalled();
  });

  it('uses default attempts (3) when opts.attempts is absent', () => {
    const job = makeJob({ attemptsMade: 3, opts: {} });
    captured.handlers.failed(job, new Error('default attempts'));

    expect(moveToDLQ).toHaveBeenCalled();
  });

  it('tolerates an undefined job (uses "unknown" id, no DLQ)', () => {
    captured.handlers.failed(undefined, new Error('no job'));

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(moveToDLQ).not.toHaveBeenCalled();
  });
});
