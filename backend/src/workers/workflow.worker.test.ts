jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({})),
  WORKFLOW_QUEUE: 'workflows',
  WORKFLOW_EXECUTE_ENROLLMENT: 'workflow:execute-enrollment',
  enqueueWorkflowExecution: jest.fn(),
}));

jest.mock('../modules/workflows/workflow.repository', () => ({
  claimEnrollmentById: jest.fn(),
  findEnrollmentExecutionById: jest.fn(),
  findDueEnrollmentIds: jest.fn(),
  recordStepRun: jest.fn(),
  finishStepRun: jest.fn(),
  finishStepAndAdvance: jest.fn(),
  advanceEnrollment: jest.fn(),
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsFailed: jest.fn(),
  incJobsProcessed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../lib/dlq', () => ({ moveToDLQ: jest.fn() }));

import {
  advanceEnrollment,
  claimEnrollmentById,
  finishStepAndAdvance,
  finishStepRun,
  findEnrollmentExecutionById,
  findDueEnrollmentIds,
  recordStepRun,
} from '../modules/workflows/workflow.repository';
import {
  executeWorkflowEnrollment,
  startWorkflowWorker,
  sweepDueWorkflowEnrollments,
} from './workflow.worker';
import * as workflowActions from '../modules/workflows/workflow.actions';
import { enqueueWorkflowExecution } from './queue';

const mockClaim = claimEnrollmentById as jest.Mock;
const mockFindExecution = findEnrollmentExecutionById as jest.Mock;
const mockRecord = recordStepRun as jest.Mock;
const mockFinish = finishStepRun as jest.Mock;
const mockFinishAndAdvance = finishStepAndAdvance as jest.Mock;
const mockAdvance = advanceEnrollment as jest.Mock;
const mockFindDue = findDueEnrollmentIds as jest.Mock;
const mockEnqueueWorkflow = enqueueWorkflowExecution as jest.Mock;
const mockExecuteAction = jest.spyOn(workflowActions, 'executeWorkflowAction');

const baseEnrollment = {
  id: 'enrollment-1',
  workflow_id: 'workflow-1',
  workflow_version_id: 'version-1',
  lead_id: 'lead-1',
  status: 'active',
  current_node_id: 'trigger',
  trigger_event_id: 'event-1',
  trigger_event_type: 'lead.created',
  context: { score: 90 },
  next_run_at: null,
  lock_version: 1,
  locked_at: '2026-09-07T00:00:00.000Z',
  locked_by: 'workflow-worker',
  last_error: null,
  enrolled_at: '2026-09-07T00:00:00.000Z',
  finished_at: null,
  updated_at: '2026-09-07T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockClaim.mockResolvedValue({ ...baseEnrollment });
  mockFindExecution.mockResolvedValue({
    enrollment: { ...baseEnrollment },
    workflow_status: 'published',
    definition: {
      name: 'Safe workflow',
      entryNodeId: 'trigger',
      nodes: [
        { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['end'] },
        { id: 'end', type: 'end', next: [] },
      ],
    },
  });
  mockRecord.mockImplementation(async ({ nodeId }: { nodeId: string }) => ({
    id: `step-${nodeId}`,
    enrollment_id: 'enrollment-1',
    node_id: nodeId,
    node_type: nodeId === 'end' ? 'end' : 'trigger',
    status: 'running',
    attempt: 1,
    idempotency_key: `enrollment-1:${nodeId}`,
    job_id: 'job-1',
    input: null,
    result: null,
    error_code: null,
    error_message: null,
    started_at: '2026-09-07T00:00:00.000Z',
    finished_at: null,
    created_at: '2026-09-07T00:00:00.000Z',
  }));
  mockFinish.mockResolvedValue({});
  mockFindDue.mockResolvedValue([]);
  mockFinishAndAdvance.mockImplementation(
    async (input: { currentNodeId: string; lockVersion: number; enrollmentStatus: string }) => ({
      step: { status: 'succeeded', result: null },
      enrollment: {
        ...baseEnrollment,
        current_node_id: input.currentNodeId,
        lock_version: input.lockVersion + 1,
        status: input.enrollmentStatus,
        locked_by: 'worker-1',
      },
    }),
  );
  mockAdvance.mockImplementation(
    async (
      input: typeof baseEnrollment & { currentNodeId: string; lockVersion: number; status: string },
    ) => ({
      ...baseEnrollment,
      current_node_id: input.currentNodeId,
      lock_version: input.lockVersion + 1,
      status: input.status,
    }),
  );
});

describe('workflow worker', () => {
  it('executes a trigger-to-end graph using the claimed lease', async () => {
    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result.status).toBe('completed');
    expect(mockClaim).toHaveBeenCalledWith('enrollment-1', expect.any(String), 'worker-1');
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentId: 'enrollment-1',
        lockVersion: 1,
        workerId: 'worker-1',
      }),
    );
    expect(mockFinishAndAdvance).toHaveBeenLastCalledWith(
      expect.objectContaining({ enrollmentStatus: 'completed', workerId: 'worker-1' }),
    );
    expect(mockFinishAndAdvance.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ currentNodeId: 'end', releaseLock: false }),
    );
    expect(mockFinishAndAdvance.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ currentNodeId: 'end', releaseLock: true }),
    );
  });

  it('records action nodes as blocked and never executes a connector', async () => {
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      definition: {
        name: 'Blocked action',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['action'] },
          {
            id: 'action',
            type: 'action',
            action: { type: 'message.send', input: { channel: 'email' } },
            next: [],
          },
        ],
      },
    });
    mockAdvance
      .mockResolvedValueOnce({ ...baseEnrollment, current_node_id: 'action', lock_version: 2 })
      .mockResolvedValueOnce({ ...baseEnrollment, status: 'failed', lock_version: 3 });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result.status).toBe('action_blocked');
    expect(mockFinishAndAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentStatus: 'failed',
        stepStatus: 'failed',
        errorCode: 'ACTION_EXECUTION_DISABLED',
        workerId: 'worker-1',
      }),
    );
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('executes an allowlisted action and advances to its continuation', async () => {
    mockExecuteAction.mockResolvedValueOnce({
      actionType: 'lead.add_tag',
      changed: true,
      details: { tag: 'priority' },
    });
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      workflow_created_by: 'manager-1',
      workflow_created_by_role: 'manager',
      definition: {
        name: 'Internal action',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['action'] },
          {
            id: 'action',
            type: 'action',
            action: { type: 'lead.add_tag', input: { tag: 'priority' } },
            next: ['end'],
          },
          { id: 'end', type: 'end', next: [] },
        ],
      },
    });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result.status).toBe('completed');
    expect(mockExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lead.add_tag' }),
      expect.objectContaining({
        leadId: 'lead-1',
        actor: { id: 'manager-1', role: 'manager' },
      }),
    );
    expect(mockFinishAndAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        stepStatus: 'succeeded',
        currentNodeId: 'end',
        stepResult: {
          actionType: 'lead.add_tag',
          changed: true,
          details: { tag: 'priority' },
        },
      }),
    );
  });

  it('records a transient action failure and releases the lease for retry', async () => {
    mockExecuteAction.mockRejectedValueOnce(new Error('temporary CRM dependency failure'));
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      workflow_created_by: 'manager-1',
      workflow_created_by_role: 'manager',
      definition: {
        name: 'Retry workflow',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['action'] },
          {
            id: 'action',
            type: 'action',
            action: { type: 'lead.add_tag', input: { tag: 'priority' } },
            next: ['end'],
          },
          { id: 'end', type: 'end', next: [] },
        ],
      },
    });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result).toEqual({ status: 'retry_scheduled', processedNodes: 2 });
    expect(mockFinishAndAdvance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stepStatus: 'failed',
        enrollmentStatus: 'active',
        currentNodeId: 'action',
        nextRunAt: expect.any(String),
        releaseLock: true,
        errorCode: 'ACTION_EXECUTION_FAILED',
      }),
    );
  });

  it('continues long workflows in a later job after the per-job node budget', async () => {
    const chain = Array.from({ length: 21 }, (_, index) => `goal-${index}`);
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      definition: {
        name: 'Long workflow',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: [chain[0]] },
          ...chain.map((id, index) => ({
            id,
            type: 'goal' as const,
            goal: { field: 'score', operator: 'gte' as const, value: 1000 },
            next: [chain[index + 1] ?? 'end'],
          })),
          { id: 'end', type: 'end', next: [] },
        ],
      },
    });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result).toEqual({ status: 'continued', processedNodes: 20 });
    expect(mockAdvance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentNodeId: 'goal-19',
        status: 'active',
        releaseLock: true,
      }),
    );
  });

  it('moves a wait node to waiting and schedules its single continuation', async () => {
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      definition: {
        name: 'Wait workflow',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['wait'] },
          { id: 'wait', type: 'wait', waitMinutes: 15, next: ['end'] },
          { id: 'end', type: 'end', next: [] },
        ],
      },
    });
    mockFinishAndAdvance
      .mockResolvedValueOnce({
        step: { status: 'succeeded', result: null },
        enrollment: { ...baseEnrollment, current_node_id: 'wait', lock_version: 2 },
      })
      .mockResolvedValueOnce({
        step: { status: 'waiting', result: { waitMinutes: 15 } },
        enrollment: {
          ...baseEnrollment,
          current_node_id: 'end',
          status: 'waiting',
          lock_version: 3,
        },
      });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result.status).toBe('waiting');
    expect(mockFinishAndAdvance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stepStatus: 'waiting',
        enrollmentStatus: 'waiting',
        currentNodeId: 'end',
        releaseLock: true,
        nextRunAt: expect.any(String),
      }),
    );
  });

  it('evaluates a goal and completes when the goal predicate is met', async () => {
    mockFindExecution.mockResolvedValueOnce({
      enrollment: { ...baseEnrollment },
      workflow_status: 'published',
      definition: {
        name: 'Goal workflow',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', trigger: { event: 'lead.created' }, next: ['goal'] },
          {
            id: 'goal',
            type: 'goal',
            goal: { field: 'score', operator: 'gte', value: 80 },
            next: ['end'],
          },
          { id: 'end', type: 'end', next: [] },
        ],
      },
    });
    mockFinishAndAdvance
      .mockResolvedValueOnce({
        step: { status: 'succeeded', result: null },
        enrollment: { ...baseEnrollment, current_node_id: 'goal', lock_version: 2 },
      })
      .mockResolvedValueOnce({
        step: { status: 'succeeded', result: { goalMet: true } },
        enrollment: {
          ...baseEnrollment,
          current_node_id: 'goal',
          status: 'completed',
          lock_version: 3,
        },
      });

    const result = await executeWorkflowEnrollment('enrollment-1', 'worker-1', 'job-1');

    expect(result.status).toBe('completed');
    expect(mockFinishAndAdvance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stepResult: { goalMet: true },
        enrollmentStatus: 'completed',
        releaseLock: true,
      }),
    );
  });

  it('starts a BullMQ worker with the workflow queue', () => {
    expect(() => startWorkflowWorker()).not.toThrow();
  });

  it('sweeps due enrollments by enqueueing IDs without claiming them', async () => {
    mockFindDue.mockResolvedValue(['enrollment-1', 'enrollment-2']);
    mockEnqueueWorkflow.mockResolvedValue(undefined);

    await expect(sweepDueWorkflowEnrollments(10)).resolves.toBe(2);
    expect(mockFindDue).toHaveBeenCalledWith(expect.any(String), 10);
    expect(mockEnqueueWorkflow).toHaveBeenNthCalledWith(
      1,
      { enrollmentId: 'enrollment-1' },
      { jobIdSuffix: expect.stringMatching(/^recovery-/) },
    );
    expect(mockEnqueueWorkflow).toHaveBeenNthCalledWith(
      2,
      { enrollmentId: 'enrollment-2' },
      { jobIdSuffix: expect.stringMatching(/^recovery-/) },
    );
  });
});
