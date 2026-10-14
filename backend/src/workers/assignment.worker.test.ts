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
  getEligibleUsers: jest.fn(),
}));

jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

jest.mock('../modules/integrations/notifications', () => ({
  notifyAssignment: jest.fn(),
}));

jest.mock('../modules/notifications/notifications.service', () => ({
  createNotification: jest.fn().mockResolvedValue({ ok: true }),
}));
import { startAssignmentWorker } from './assignment.worker';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { autoAssignLead } from '../modules/assignments/assignments.service';
import { getEligibleUsers } from '../modules/assignments/assignments.service';
import { findLeadById } from '../modules/leads/leads.repository';
import { notifyAssignment } from '../modules/integrations/notifications';
import { createNotification } from '../modules/notifications/notifications.service';

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
  return { id: 'assign1', assigned_to: 'user1', assigned_by: null, ...over };
}

function autoResult(over: Partial<any> = {}): any {
  return {
    assignment: assignment(),
    previousOwnerId: null,
    ...over,
  };
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
    (getEligibleUsers as jest.Mock).mockResolvedValue([]);

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({ leadId: 'lead1', assigned: false, notified: false });
    expect(autoAssignLead).not.toHaveBeenCalled();
    expect(incJobsProcessed).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  it('uses the service-configured eligibility set for the pre-check', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([]);
    await captured.processor!(makeJob());
    expect(getEligibleUsers).toHaveBeenCalledTimes(1);
  });

  it('returns assigned=false when autoAssignLead returns null', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(null);

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({ leadId: 'lead1', assigned: false, notified: false });
    expect(notifyAssignment).not.toHaveBeenCalled();
  });

  it('assigns, fetches lead name, notifies, and pushes to user', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    const result0 = autoResult();
    (autoAssignLead as jest.Mock).mockResolvedValue(result0);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: 'Acme Co' });
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect(autoAssignLead).toHaveBeenCalledWith(
      'lead1',
      expect.objectContaining({ score: 85, classification: 'hot' }),
    );
    expect(notifyAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead1',
        leadName: 'Acme Co',
        assignedTo: 'user1',
        score: 85,
        classification: 'hot',
      }),
    );
    // The durable notification is created inside the service transaction;
    // The service publishes post-commit effects once and the worker creates no second row.
    expect(createNotification).not.toHaveBeenCalled();
    expect(result).toEqual({
      leadId: 'lead1',
      assigned: true,
      assignedTo: 'user1',
      notified: true,
    });
    expect(observeJobDuration).toHaveBeenCalled();
  });

  it('uses null business name when lead lookup returns null', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(autoResult());
    (findLeadById as jest.Mock).mockResolvedValue(null);
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect(notifyAssignment).toHaveBeenCalledWith(expect.objectContaining({ leadName: null }));
    expect((result as any).assigned).toBe(true);
  });

  it('still succeeds when findLeadById throws (notification context failure)', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(autoResult());
    (findLeadById as jest.Mock).mockRejectedValue(new Error('db down'));
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());

    expect((result as any).assigned).toBe(true);
    expect(notifyAssignment).toHaveBeenCalledWith(expect.objectContaining({ leadName: null }));
  });

  it('handles non-Error thrown by findLeadById', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(autoResult());
    (findLeadById as jest.Mock).mockRejectedValue('string-error');
    (notifyAssignment as jest.Mock).mockResolvedValue({ ok: true });

    const result = await captured.processor!(makeJob());
    expect((result as any).assigned).toBe(true);
  });

  it('marks notified=false when notifyAssignment throws but assignment still succeeds', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(autoResult());
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: 'Acme Co' });
    (notifyAssignment as jest.Mock).mockRejectedValue(new Error('slack down'));

    const result = await captured.processor!(makeJob());

    expect(result).toEqual({
      leadId: 'lead1',
      assigned: true,
      assignedTo: 'user1',
      notified: false,
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('handles non-Error thrown by notifyAssignment', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockResolvedValue(autoResult());
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', business_name: null });
    (notifyAssignment as jest.Mock).mockRejectedValue('boom');

    const result = await captured.processor!(makeJob());
    expect((result as any).notified).toBe(false);
  });

  it('rethrows when autoAssignLead fails so BullMQ retries the job', async () => {
    (getEligibleUsers as jest.Mock).mockResolvedValue([{ id: 'user1' }]);
    (autoAssignLead as jest.Mock).mockRejectedValue(new Error('Postgres connection lost'));

    await expect(captured.processor!(makeJob())).rejects.toThrow('Postgres connection lost');
  });
});

describe('processor — error handling', () => {
  it('throws and increments failed counter for unknown job name', async () => {
    await expect(captured.processor!(makeJob({ name: 'assignment:bogus' }))).rejects.toThrow(
      'Unknown assignment job: assignment:bogus',
    );
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('rethrows service errors and increments failed counter', async () => {
    (getEligibleUsers as jest.Mock).mockRejectedValue(new Error('repo down'));

    await expect(captured.processor!(makeJob())).rejects.toThrow('repo down');
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('handles a non-Error thrown value in the processor catch block', async () => {
    (getEligibleUsers as jest.Mock).mockRejectedValue('plain string');

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
