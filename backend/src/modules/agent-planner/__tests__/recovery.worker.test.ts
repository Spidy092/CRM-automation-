jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { runRecoverySweep, startAgentPlanRecoveryWorker, scheduleAgentPlanRecovery } from '../recovery.worker';
import { findStaleRunningPlans, updatePlanStatus } from '../plan.repository';
import { getBullConnection } from '../../../workers/queue';

jest.mock('../plan.repository');
jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockedFindStaleRunningPlans = findStaleRunningPlans as jest.MockedFunction<
  typeof findStaleRunningPlans
>;
const mockedUpdatePlanStatus = updatePlanStatus as jest.MockedFunction<typeof updatePlanStatus>;
const mockedGetBullConnection = getBullConnection as jest.MockedFunction<typeof getBullConnection>;

describe('recovery worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetBullConnection.mockReturnValue({} as any);
  });

  it('marks stale running plans as failed', async () => {
    mockedFindStaleRunningPlans.mockResolvedValue([
      {
        id: 'plan-1',
        status: 'running',
      } as any,
    ]);
    mockedUpdatePlanStatus.mockResolvedValue({ id: 'plan-1', status: 'failed' } as any);

    const swept = await runRecoverySweep({ staleAfterSeconds: 60 });

    expect(swept).toBeGreaterThanOrEqual(1);
    expect(mockedUpdatePlanStatus).toHaveBeenCalledWith(
      'plan-1',
      'failed',
      expect.objectContaining({ errorMessage: 'stale_running_plan_recovered' }),
    );
  });

  it('does not touch fresh running plans', async () => {
    mockedFindStaleRunningPlans.mockResolvedValue([]);

    const swept = await runRecoverySweep({ staleAfterSeconds: 600 });

    expect(swept).toBe(0);
    expect(mockedUpdatePlanStatus).not.toHaveBeenCalled();
  });

  it('starts a BullMQ worker', () => {
    startAgentPlanRecoveryWorker();
    const { Worker } = jest.requireMock('bullmq');
    expect(Worker).toHaveBeenCalledWith(
      'agent-plan-recovery',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it('schedules a repeatable recovery job', async () => {
    const { Queue } = jest.requireMock('bullmq');
    await scheduleAgentPlanRecovery();
    expect(Queue).toHaveBeenCalledWith('agent-plan-recovery', expect.any(Object));
    const queueInstance = Queue.mock.results[0].value;
    expect(queueInstance.add).toHaveBeenCalledWith(
      'agent-plan:recover-stale',
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({ every: 60_000 }),
        jobId: 'agent-plan:recover-stale:cron',
      }),
    );
  });
});
