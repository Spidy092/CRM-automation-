jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { planSchema } from '../plan.schema';

describe('planSchema', () => {
  const validStep = {
    step_index: 0,
    action_name: 'lead.list',
    action_args: { limit: 10 },
    risk_tier: 'read',
    depends_on: [],
    rationale: 'Get a list of leads',
  };

  it('accepts a minimal valid plan', () => {
    const result = planSchema.safeParse({
      goal: 'find leads',
      steps: [validStep],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty steps array', () => {
    const result = planSchema.safeParse({ goal: 'x', steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 8 steps', () => {
    const steps = Array.from({ length: 9 }, (_, i) => ({ ...validStep, step_index: i }));
    const result = planSchema.safeParse({ goal: 'x', steps });
    expect(result.success).toBe(false);
  });

  it('rejects step_indexes that are not contiguous', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, step_index: 0 }, { ...validStep, step_index: 2 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects depends_on referencing missing step_index', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, step_index: 0 },
        { ...validStep, step_index: 1, depends_on: [5] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects cycles (A depends on B, B depends on A)', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, step_index: 0, depends_on: [1] },
        { ...validStep, step_index: 1, depends_on: [0] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects risk_tier that does not match the action definition', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, risk_tier: 'sensitive_write' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects action_args that fail the action schema', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [{ ...validStep, action_args: { limit: 'not-a-number' } }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects compliance_critical actions', () => {
    const result = planSchema.safeParse({
      goal: 'x',
      steps: [
        { ...validStep, action_name: 'ai.inbox.action', risk_tier: 'compliance_critical' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid DAG (diamond)', () => {
    const result = planSchema.safeParse({
      goal: 'diamond',
      steps: [
        { ...validStep, step_index: 0, action_name: 'lead.list', risk_tier: 'read' },
        { ...validStep, step_index: 1, action_name: 'lead.get', risk_tier: 'read', depends_on: [0], action_args: { id: '00000000-0000-0000-0000-000000000001' } },
        { ...validStep, step_index: 2, action_name: 'lead.get', risk_tier: 'read', depends_on: [0], action_args: { id: '00000000-0000-0000-0000-000000000002' } },
        { ...validStep, step_index: 3, action_name: 'campaign.stats', risk_tier: 'read', depends_on: [1, 2], action_args: { id: '00000000-0000-0000-0000-000000000003' } },
      ],
    });
    expect(result.success).toBe(true);
  });
});