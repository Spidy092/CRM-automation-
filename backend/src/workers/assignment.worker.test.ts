/**
 * Assignment worker tests.
 *
 * The assignment worker keeps its processor and event handlers inline in the
 * `new Worker(...)` call. We mock `bullmq` so the Worker constructor captures
 * the processor callback and `.on()` handlers, then drive them with fake jobs.
 * Every dependency (service/repo/dlq/metrics/sentry/notifications) is mocked —
 * no real Redis/DB/queue is touched.
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
  ASSIGNMENT_QUEUE: 'assignment',
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

jest.mock('../modules/assignments/assignments.service', () => ({
  autoAssignLead: jest.fn(),
}));

jest.mock('../modules/assignments/assignments.repository', () => ({
  findEligibleUsers: jest.fn(),
}));

jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

jest.mock('../modules/integrations/notifications', () => ({
  notifyAssignment: jest.fn(),
}));

jest.mock('../modules/notifications/notifications.emitter', () => ({
  pushToUser: jest.fn(),
}));

import { startAssignmentWorker } from './assignment.worker';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { autoAssignLead } from '../modules/assignments/assignments.service';
import { findEligibleUsers } from '../modules/assignments/assignments.repository';
import { findLeadById } from '../modules/leads/leads.repository';
import { notifyAssignment } from '../modules/integrations/notifications';
import { pushToUser } from '../modules/notifications/notifications.emitter';

const ASSIGNMENT_ROUND_ROBIN = 'assignment:round-robin';

function makeJob(over: Partial<any> = {}): any {
  return {
    id: 'job-1',
    name: ASSIGNMENT_ROUND_ROBIN,
    data: { leadId: 'lead1', score: 85, classification: 'hot' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...over,
  };
}

function assignment(over: Partial<any> = {}): any {
  return { assigned_to: 'user1', assigned_by: 'system', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  captured.processor = null;
  captured.handlers = {};
  startAssignmentWorker();
});

describe('startAssignmentWorker', () => {
  it('starts and registers ready + failed handlers', () => {
    expect(captured.processor).toBeInstanceOf(Function);
    expect(captured.handlers.ready).toBeInstanceOf(Function);
    expect(captured.handlers.failed).toBeInstanceOf(Function);
    expect(() => captured.handlers.ready()).not.toThrow();
  });
});

describe('processor — assignment:round-robin', () => {
  it('skips when no eligible users', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([]);

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({ leadId: 'lead1', assigned: false, notified: false });
    expect(autoAssignLead).not.toHaveBeenCalled();
    expect(incJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('returns assigned=false when autoAssignLead returns null', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(null);

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({ leadId: 'lead1', assigned: false, notified: false });
    expect(notifyAssignment).not.toHaveBeenCalled();
  });

  it('assigns, fetches lead name, notifies, and pushes to user', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: 'Acme Co' });
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect(notifyAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead1',
        leadName: 'Acme Co',
        assignedTo: 'user1',
        score: 85,
        classification: 'hot',
      }),
    );
    expect(pushToUser).toHaveBeenCalledWith(
      'user1',
      expect.objectContaining({ type: 'lead_assigned', id: 'assign:lead1' }),
    );
    expect(result).toEqual({
      leadId: 'lead1',
      assigned: true,
      assignedTo: 'user1',
      notified: true,
    });
    expect(observeJobDuration).toHaveBeenCalled();
  });

  it('uses null business name when lead lookup returns null', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockResolvedValue(null);
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect(notifyAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ leadName: null }),
    );
    expect((result as any).assigned).toBe(true);
  });

  it('still succeeds when findLeadById throws (notification context failure)', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockRejectedValue(new Error('db down'));
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect((result as any).assigned).toBe(true);
    expect(notifyAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ leadName: null }),
    );
  });

  it('handles non-Error thrown by findLeadById', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockRejectedValue('string-error');
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());
    expect((result as any).assigned).toBe(true);
  });

  it('marks notified=false when notifyAssignment throws but assignment still succeeds', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: 'Acme Co' });
    (notifyAssignment as jest.Mock).mockRejectedValue(new Error('slack down'));

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({
      leadId: 'lead1',
      assigned: true,
      assignedTo: 'user1',
      notified: false,
    });
    expect(pushToUser).toHaveBeenCalled();
  });

  it('handles non-Error thrown by notifyAssignment', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(assignment());
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: null });
    (notifyAssignment as jest.Mock).mockRejectedValue('boom');

    const result = await captured.processor!(makeJob());
    expect((result as any).notified).toBe(false);
  });
});

describe('processor — error handling', () => {
  it('throws and increments failed counter for unknown job name', async () => {
    await expect(
      captured.processor!(makeJob({ name: 'assignment:bogus' })),
    ).rejects.toThrow('Unknown assignment job: assignment:bogus');
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('rethrows service errors and increments failed counter', async () => {
    (findEligibleUsers as jest.Mock).mockRejectedValue(new Error('repo down'));

    await expect(captured.processor!(makeJob())).rejects.toThrow('repo down');
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('handles a non-Error thrown value in the processor catch block', async () => {
    (findEligibleUsers as jest.Mock).mockRejectedValue('plain string');

    await expect(captured.processor!(makeJob())).rejects.toBe('plain string');
    expect(incJobsFailed).toHaveBeenCalled();
  });
});

describe('failed handler — DLQ routing', () => {
  it('moves to DLQ on the final attempt', () => {
    const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
    captured.handlers.failed(job, new Error('final fail'));

    expect(Sentry.captureException).toHaveBeenCalled();
    expect(moveToDLQ).toHaveBeenCalledWith(
      'assignment',
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
