jest.mock('../../../workers/queue');

import { topoSortIntoWaves } from '../runner.topo';
import type { PlanStepRow } from '../plan.types';

function step(index: number, dependsOn: number[] = [], overrides: Partial<PlanStepRow> = {}): PlanStepRow {
  return {
    id: `step-${index}`,
    plan_id: 'plan-1',
    step_index: index,
    action_name: 'lead.list',
    action_args: {},
    risk_tier: 'read',
    depends_on: dependsOn,
    rationale: `step ${index}`,
    status: 'pending',
    agent_action_id: null,
    result: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe('topoSortIntoWaves', () => {
  it('returns single wave for linear steps with no deps', () => {
    const steps = [step(0), step(1), step(2)];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((s) => s.step_index)).toEqual([0, 1, 2]);
  });

  it('returns N waves for a linear chain', () => {
    const steps = [step(0), step(1, [0]), step(2, [1])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(3);
  });

  it('groups parallel steps in one wave', () => {
    const steps = [step(0), step(1, [0]), step(2, [0]), step(3, [1, 2])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((s) => s.step_index)).toEqual([0]);
    expect(waves[1].map((s) => s.step_index).sort()).toEqual([1, 2]);
    expect(waves[2].map((s) => s.step_index)).toEqual([3]);
  });

  it('handles diamond shape correctly', () => {
    const steps = [step(0), step(1, [0]), step(2, [0]), step(3, [1, 2]), step(4, [3])];
    const waves = topoSortIntoWaves(steps);
    expect(waves).toHaveLength(4);
    expect(waves[1].map((s) => s.step_index).sort()).toEqual([1, 2]);
  });

  it('throws on cycles', () => {
    const steps = [step(0, [1]), step(1, [0])];
    expect(() => topoSortIntoWaves(steps)).toThrow(/cycle/i);
  });
});