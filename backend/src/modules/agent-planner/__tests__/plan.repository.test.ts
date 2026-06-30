import { pool, queryOne } from '../../../shared/utils/db';
import {
  createPlan,
  createPlanStep,
  findPlanById,
  findPlanStepById,
  findPlanStepsByPlan,
  updatePlanStatus,
  updatePlanStepStatus,
  findStaleRunningPlans,
} from '../plan.repository';

jest.mock('../../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedPoolQuery = pool.query as jest.Mock;

const basePlanRow = {
  id: 'plan-1',
  conversation_id: null,
  goal: 'test goal',
  status: 'proposed',
  autonomy_level: 'supervised',
  confidence: null,
  source: 'chat',
  requested_by: null,
  source_message: 'hi',
  cost_cap_cents: 50,
  step_cap: 8,
  cost_used_cents: 0,
  deadline_at: null,
  started_at: null,
  completed_at: null,
  expires_at: null,
  error_message: null,
  created_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
  idempotency_key: 'idem-1',
};

const baseStepRow = {
  id: 'step-1',
  plan_id: 'plan-1',
  step_index: 0,
  action_name: 'lead.list',
  action_args: { limit: 10 },
  risk_tier: 'read',
  depends_on: [],
  rationale: 'start',
  status: 'pending',
  agent_action_id: null,
  result: null,
  error_message: null,
  started_at: null,
  completed_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createPlan', () => {
  it('returns created row on success', async () => {
    mockedQueryOne.mockResolvedValue(basePlanRow);

    const plan = await createPlan({
      conversationId: null,
      goal: 'test goal',
      autonomyLevel: 'supervised',
      confidence: null,
      source: 'chat',
      requestedBy: null,
      sourceMessage: 'hi',
      steps: [],
      idempotencyKey: 'idem-1',
      expiresAt: null,
    });

    expect(plan.goal).toBe('test goal');
    expect(plan.status).toBe('proposed');
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws when insert returns null', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(
      createPlan({
        conversationId: null,
        goal: 'g',
        autonomyLevel: null,
        confidence: null,
        source: 'chat',
        requestedBy: null,
        sourceMessage: null,
        steps: [],
        idempotencyKey: 'idem-2',
        expiresAt: null,
      }),
    ).rejects.toThrow('Failed to create plan');
  });
});

describe('createPlanStep', () => {
  it('returns created step', async () => {
    mockedQueryOne.mockResolvedValue(baseStepRow);

    const step = await createPlanStep({
      planId: 'plan-1',
      stepIndex: 0,
      actionName: 'lead.list',
      actionArgs: { limit: 10 },
      riskTier: 'read',
      dependsOn: [],
      rationale: 'start',
    });

    expect(step.step_index).toBe(0);
    expect(step.status).toBe('pending');
  });
});

describe('findPlanById', () => {
  it('returns plan by id', async () => {
    mockedQueryOne.mockResolvedValue(basePlanRow);

    const plan = await findPlanById('plan-1');

    expect(plan?.id).toBe('plan-1');
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const plan = await findPlanById('missing');

    expect(plan).toBeNull();
  });
});

describe('findPlanStepsByPlan', () => {
  it('returns steps ordered by step_index', async () => {
    const step1 = { ...baseStepRow, id: 'step-2', step_index: 1 };
    mockedPoolQuery.mockResolvedValue({ rows: [baseStepRow, step1] });

    const steps = await findPlanStepsByPlan('plan-1');

    expect(steps.map((s) => s.step_index)).toEqual([0, 1]);
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY step_index ASC'),
      ['plan-1'],
    );
  });
});

describe('updatePlanStatus', () => {
  it('persists status change', async () => {
    mockedQueryOne.mockResolvedValue({ ...basePlanRow, status: 'running' });

    const updated = await updatePlanStatus('plan-1', 'running');

    expect(updated.status).toBe('running');
  });

  it('throws when plan not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(updatePlanStatus('missing', 'running')).rejects.toThrow('Plan not found: missing');
  });
});

describe('updatePlanStepStatus', () => {
  it('persists step status with result', async () => {
    mockedQueryOne.mockResolvedValue({ ...baseStepRow, status: 'succeeded', result: { ok: true } });

    const updated = await updatePlanStepStatus('step-1', 'succeeded', { result: { ok: true } });

    expect(updated.status).toBe('succeeded');
    expect(updated.result).toEqual({ ok: true });
  });
});

describe('findStaleRunningPlans', () => {
  it('returns running plans older than threshold', async () => {
    const stalePlan = { ...basePlanRow, id: 'plan-stale', status: 'running' };
    mockedPoolQuery.mockResolvedValue({ rows: [stalePlan] });

    const stale = await findStaleRunningPlans(60);

    expect(stale.some((p) => p.id === 'plan-stale')).toBe(true);
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'running'"),
      ['60'],
    );
  });
});
