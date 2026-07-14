jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { proposeAgentAction, linkPlanToAction } from '../../agent/agent.service';
import {
  findPlanById,
  findPlanStepsByPlan,
  updatePlanStatus,
  updatePlanStepStatus,
  claimPlanForRecovery,
} from '../plan.repository';
import { executePlan, continuePlanIfReady, cancelPlan } from '../runner.service';
import type { PlanRow, PlanStepRow } from '../plan.types';


jest.mock('../plan.repository');
jest.mock('../../agent/agent.service');
jest.mock('../metrics');

const mockedFindPlanById = findPlanById as jest.MockedFunction<typeof findPlanById>;
const mockedFindPlanStepsByPlan = findPlanStepsByPlan as jest.MockedFunction<typeof findPlanStepsByPlan>;
const mockedUpdatePlanStatus = updatePlanStatus as jest.MockedFunction<typeof updatePlanStatus>;
const mockedUpdatePlanStepStatus = updatePlanStepStatus as jest.MockedFunction<typeof updatePlanStepStatus>;
const mockedClaimPlanForRecovery = claimPlanForRecovery as jest.MockedFunction<typeof claimPlanForRecovery>;
const mockedProposeAgentAction = proposeAgentAction as jest.MockedFunction<typeof proposeAgentAction>;
const mockedLinkPlanToAction = linkPlanToAction as jest.MockedFunction<typeof linkPlanToAction>;

const actor = { id: 'user-1', role: 'admin', email: null, name: null, ipAddress: null };

function basePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 'plan-1',
    conversation_id: null,
    goal: 'test goal',
    status: 'approved',
    autonomy_level: 'supervised',
    confidence: 0.95,
    source: 'chat',
    requested_by: 'user-1',
    source_message: 'do something',
    cost_cap_cents: 100,
    step_cap: 10,
    cost_used_cents: 0,
    deadline_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    started_at: null,
    completed_at: null,
    expires_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    idempotency_key: 'key-1',
    ...overrides,
  };
}

function baseStep(overrides: Partial<PlanStepRow> = {}): PlanStepRow {
  return {
    id: 'step-0',
    plan_id: 'plan-1',
    step_index: 0,
    action_name: 'lead.list',
    action_args: { limit: 5 },
    risk_tier: 'read',
    depends_on: [],
    rationale: 'fetch leads',
    status: 'pending',
    agent_action_id: null,
    result: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('executePlan', () => {
  it('executes a single read step end-to-end and returns status succeeded', async () => {
    const plan = basePlan();
    const runningPlan = { ...plan, status: 'running' as const };
    const succeededPlan = { ...plan, status: 'succeeded' as const };

    mockedFindPlanById.mockResolvedValue(plan);
    mockedUpdatePlanStatus.mockResolvedValueOnce(runningPlan).mockResolvedValueOnce(succeededPlan);
    mockedFindPlanStepsByPlan.mockResolvedValue([baseStep()]);
    mockedUpdatePlanStepStatus.mockResolvedValue(baseStep({ status: 'succeeded' }));

    mockedProposeAgentAction.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'Autonomous execution allowed' },
      action: { id: 'action-1', result: { leads: [] } },
      result: { leads: [] },
    } as any);

    const result = await executePlan('plan-1', actor as any);

    expect(result).toEqual({ planId: 'plan-1', status: 'succeeded', errorMessage: null });
    expect(mockedUpdatePlanStatus).toHaveBeenCalledWith('plan-1', 'running', expect.any(Object));
    expect(mockedProposeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'chat',
        actionName: 'lead.list',
        args: { limit: 5 },
        actor,
      }),
    );
    expect(mockedUpdatePlanStepStatus).toHaveBeenCalledWith(
      'step-0',
      'succeeded',
      expect.objectContaining({ result: { leads: [] }, agentActionId: 'action-1' }),
    );
  });

  it('pauses plan when step requires approval and returns status paused_for_approval', async () => {
    const plan = basePlan();
    const runningPlan = { ...plan, status: 'running' as const };
    const pausedPlan = { ...plan, status: 'paused_for_approval' as const };

    mockedFindPlanById.mockResolvedValue(plan);
    mockedUpdatePlanStatus.mockResolvedValueOnce(runningPlan).mockResolvedValueOnce(pausedPlan);
    mockedFindPlanStepsByPlan.mockResolvedValue([baseStep({ risk_tier: 'sensitive_write' })]);
    mockedUpdatePlanStepStatus.mockResolvedValue(baseStep({ status: 'pending_approval' }));

    mockedProposeAgentAction.mockResolvedValue({
      policy: { outcome: 'require_approval', reason: 'Sensitive write requires approval', assignTo: 'manager-1' },
      action: { id: 'action-2' },
    } as any);

    const result = await executePlan('plan-1', actor as any);

    expect(result).toEqual({ planId: 'plan-1', status: 'paused_for_approval', errorMessage: null });
    expect(mockedLinkPlanToAction).toHaveBeenCalledWith('action-2', 'plan-1', 'step-0');
    expect(mockedUpdatePlanStepStatus).toHaveBeenCalledWith(
      'step-0',
      'pending_approval',
      expect.objectContaining({ agentActionId: 'action-2' }),
    );
    expect(mockedUpdatePlanStatus).toHaveBeenLastCalledWith('plan-1', 'paused_for_approval');
  });

  it('fails plan when required step is rejected and returns status failed', async () => {
    const plan = basePlan();
    const runningPlan = { ...plan, status: 'running' as const };
    const failedPlan = { ...plan, status: 'failed' as const, error_message: 'Policy rejected' };

    mockedFindPlanById.mockResolvedValue(plan);
    mockedUpdatePlanStatus.mockResolvedValueOnce(runningPlan).mockResolvedValueOnce(failedPlan);
    mockedFindPlanStepsByPlan.mockResolvedValue([baseStep({ risk_tier: 'sensitive_write' })]);
    mockedUpdatePlanStepStatus.mockResolvedValue(baseStep({ status: 'failed' }));

    mockedProposeAgentAction.mockResolvedValue({
      policy: { outcome: 'reject', reason: 'Policy rejected' },
      action: null,
    } as any);

    const result = await executePlan('plan-1', actor as any);

    expect(result).toEqual({ planId: 'plan-1', status: 'failed', errorMessage: 'Policy rejected' });
    expect(mockedUpdatePlanStepStatus).toHaveBeenCalledWith(
      'step-0',
      'failed',
      expect.objectContaining({ errorMessage: 'Policy rejected' }),
    );
    expect(mockedUpdatePlanStatus).toHaveBeenLastCalledWith(
      'plan-1',
      'failed',
      expect.objectContaining({ errorMessage: 'Policy rejected' }),
    );
  });

  it('does not advance past a wave containing a step still pending approval', async () => {
    const plan = basePlan({ status: 'paused_for_approval', started_at: new Date().toISOString() });

    mockedFindPlanById.mockResolvedValue(plan);
    mockedUpdatePlanStatus.mockResolvedValue(plan);
    mockedFindPlanStepsByPlan.mockResolvedValue([
      baseStep({ id: 'step-0', step_index: 0, status: 'succeeded', result: { items: [] } }),
      baseStep({
        id: 'step-1',
        step_index: 1,
        action_name: 'template.create',
        risk_tier: 'sensitive_write',
        status: 'pending_approval',
      }),
      baseStep({
        id: 'step-2',
        step_index: 2,
        action_name: 'sequence.create',
        action_args: { name: 'seq', steps: [{ templateId: '$steps.1.id' }] },
        risk_tier: 'sensitive_write',
        depends_on: [1],
        status: 'pending',
      }),
    ]);

    const result = await executePlan('plan-1', actor as any);

    expect(result.status).toBe('paused_for_approval');
    expect(mockedProposeAgentAction).not.toHaveBeenCalled();
    expect(mockedUpdatePlanStatus).toHaveBeenLastCalledWith('plan-1', 'paused_for_approval');
  });

  it('resolves $steps references from earlier step results before proposing', async () => {
    const plan = basePlan();
    const runningPlan = { ...plan, status: 'running' as const };

    mockedFindPlanById.mockResolvedValue(plan);
    mockedUpdatePlanStatus.mockResolvedValue(runningPlan);
    mockedFindPlanStepsByPlan.mockResolvedValue([
      baseStep({
        id: 'step-0',
        step_index: 0,
        action_name: 'template.create',
        risk_tier: 'sensitive_write',
        status: 'succeeded',
        result: { id: 'tpl-1' },
      }),
      baseStep({
        id: 'step-1',
        step_index: 1,
        action_name: 'sequence.create',
        action_args: {
          name: 'seq',
          steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: '$steps.0.id' }],
        },
        risk_tier: 'sensitive_write',
        depends_on: [0],
        status: 'pending',
      }),
    ]);
    mockedUpdatePlanStepStatus.mockResolvedValue(baseStep({ status: 'succeeded' }));
    mockedProposeAgentAction.mockResolvedValue({
      policy: { outcome: 'execute_now', reason: 'ok' },
      action: { id: 'action-1', result: { id: 'seq-1' } },
      result: { id: 'seq-1' },
    } as any);

    const result = await executePlan('plan-1', actor as any);

    expect(result.status).toBe('succeeded');
    expect(mockedProposeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: 'sequence.create',
        args: {
          name: 'seq',
          steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: 'tpl-1' }],
        },
      }),
    );
  });
});

describe('continuePlanIfReady', () => {
  it('returns null when no plan is paused for approval', async () => {
    mockedFindPlanById.mockResolvedValue(basePlan({ status: 'running' }));

    const result = await continuePlanIfReady('plan-1');

    expect(result).toBeNull();
    expect(mockedClaimPlanForRecovery).not.toHaveBeenCalled();
    expect(mockedUpdatePlanStatus).not.toHaveBeenCalled();
  });
});

describe('cancelPlan', () => {
  it('updates plan status to cancelled', async () => {
    const cancelledPlan = basePlan({ status: 'cancelled' });
    mockedUpdatePlanStatus.mockResolvedValue(cancelledPlan);

    const result = await cancelPlan('plan-1');

    expect(result.status).toBe('cancelled');
    expect(mockedUpdatePlanStatus).toHaveBeenCalledWith(
      'plan-1',
      'cancelled',
      expect.objectContaining({ completedAt: expect.any(String) }),
    );
  });
});
