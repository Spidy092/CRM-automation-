jest.mock('../../../workers/queue');

import { createBudgetTracker } from '../runner.budget';
import { RunnerError } from '../errors';
import type { PlanRow, PlanStepRow } from '../plan.types';

const plan: PlanRow = {
  id: 'plan-1',
  conversation_id: null,
  goal: 'g',
  status: 'running',
  autonomy_level: 'supervised',
  confidence: null,
  source: 'chat',
  requested_by: null,
  source_message: null,
  cost_cap_cents: 50,
  step_cap: 8,
  cost_used_cents: 0,
  deadline_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  started_at: null,
  completed_at: null,
  expires_at: null,
  error_message: null,
  created_at: '',
  updated_at: '',
  idempotency_key: '',
};

const step = (i: number, risk: PlanStepRow['risk_tier'] = 'read'): PlanStepRow => ({
  id: `s-${i}`,
  plan_id: 'plan-1',
  step_index: i,
  action_name: 'lead.list',
  action_args: {},
  risk_tier: risk,
  depends_on: [],
  rationale: 'r',
  status: 'pending',
  agent_action_id: null,
  result: null,
  error_message: null,
  started_at: null,
  completed_at: null,
});

describe('createBudgetTracker', () => {
  it('assertCanStartStep passes for normal conditions', () => {
    const b = createBudgetTracker(plan);
    expect(() => b.assertCanStartStep(step(0))).not.toThrow();
  });

  it('assertCanStartStep throws after deadline', () => {
    const expired = { ...plan, deadline_at: new Date(Date.now() - 1000).toISOString() };
    const b = createBudgetTracker(expired);
    expect(() => b.assertCanStartStep(step(0))).toThrow(RunnerError);
  });

  it('assertCanStartStep throws when step cap reached', () => {
    const capped = { ...plan, step_cap: 1 };
    const b = createBudgetTracker(capped);
    b.recordStepStart();
    expect(() => b.assertCanStartStep(step(1))).toThrow(/step_cap|budget/i);
  });

  it('recordStepCost accumulates toward cap', () => {
    const b = createBudgetTracker(plan);
    b.recordStepCost(step(0, 'customer_facing_write'), 25);
    b.recordStepCost(step(1, 'customer_facing_write'), 25);
    expect(() => b.assertCanStartStep(step(2))).toThrow(/cost_cap|budget/i);
  });

  it('getRemainingCost returns cap minus used', () => {
    const b = createBudgetTracker(plan);
    b.recordStepCost(step(0, 'read'), 10);
    expect(b.getRemainingCost()).toBe(40);
  });
});