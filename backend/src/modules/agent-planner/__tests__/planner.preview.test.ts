jest.mock('../../../workers/queue');

import { getPlanForPreview } from '../planner.service';
import { findPlanById, findPlanStepsByPlan } from '../plan.repository';
import type { PlanStepRow } from '../plan.types';

jest.mock('../plan.repository');

const mockedFindPlanById = findPlanById as jest.MockedFunction<typeof findPlanById>;
const mockedFindPlanStepsByPlan = findPlanStepsByPlan as jest.MockedFunction<typeof findPlanStepsByPlan>;

const basePlan = {
  id: 'plan-1',
  conversation_id: null,
  goal: 'g',
  status: 'proposed',
  confidence: null,
  source: 'chat',
  requested_by: null,
  source_message: null,
  cost_cap_cents: 50,
  step_cap: 8,
  cost_used_cents: 0,
  deadline_at: null,
  started_at: null,
  completed_at: null,
  expires_at: null,
  error_message: null,
  created_at: '',
  updated_at: '',
  idempotency_key: '',
};

function step(overrides: Partial<PlanStepRow> = {}): any {
  return {
    id: 'step-1',
    plan_id: 'plan-1',
    step_index: 0,
    action_name: 'lead.list',
    action_args: {},
    risk_tier: 'read',
    depends_on: [],
    rationale: 'r',
    status: 'pending',
    agent_action_id: null,
    result: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe('planner.service.getPlanForPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns plan + steps with computed cost estimate', async () => {
    mockedFindPlanById.mockResolvedValue({ ...basePlan, autonomy_level: 'supervised' } as any);
    mockedFindPlanStepsByPlan.mockResolvedValue([
      step({ step_index: 0, risk_tier: 'read', rationale: 'get leads' }),
      step({ step_index: 1, risk_tier: 'customer_facing_write', rationale: 'launch' }),
    ]);

    const preview = await getPlanForPreview('plan-1');

    expect(preview?.steps).toHaveLength(2);
    expect(preview?.estimatedCostCents).toBeGreaterThan(0);
    expect(preview?.requiresApproval).toBe(true);
  });

  it('returns null when plan does not exist', async () => {
    mockedFindPlanById.mockResolvedValue(null);

    const preview = await getPlanForPreview('00000000-0000-0000-0000-000000000000');
    expect(preview).toBeNull();
  });

  it('requiresApproval is false when autonomy is not supervised and all steps are read or low_risk_write', async () => {
    mockedFindPlanById.mockResolvedValue({ ...basePlan, autonomy_level: 'autopilot' } as any);
    mockedFindPlanStepsByPlan.mockResolvedValue([
      step({ step_index: 0, risk_tier: 'read' }),
      step({ step_index: 1, risk_tier: 'low_risk_write' }),
    ]);

    const preview = await getPlanForPreview('plan-1');
    expect(preview?.requiresApproval).toBe(false);
  });
});