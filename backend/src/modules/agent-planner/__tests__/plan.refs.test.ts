jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import { parseStepRef, collectStepRefs, resolveStepArgs, StepRefError } from '../plan.refs';
import { planSchema } from '../plan.schema';

describe('parseStepRef', () => {
  it('parses a simple reference', () => {
    expect(parseStepRef('$steps.0.id')).toEqual({ stepIndex: 0, path: 'id' });
  });

  it('parses a nested wildcard path', () => {
    expect(parseStepRef('$steps.2.items.*.id')).toEqual({ stepIndex: 2, path: 'items.*.id' });
  });

  it('returns null for non-refs and partial matches', () => {
    expect(parseStepRef('plain string')).toBeNull();
    expect(parseStepRef('prefix $steps.0.id')).toBeNull();
    expect(parseStepRef(42)).toBeNull();
    expect(parseStepRef(null)).toBeNull();
  });
});

describe('collectStepRefs', () => {
  it('finds refs nested in objects and arrays', () => {
    const args = {
      id: '$steps.3.id',
      lead_ids: '$steps.0.items.*.id',
      nested: { steps: [{ templateId: '$steps.1.id' }] },
      plain: 'hello',
    };
    expect(collectStepRefs(args)).toEqual([0, 1, 3]);
  });

  it('returns empty for ref-free args', () => {
    expect(collectStepRefs({ limit: 10, search: 'saas' })).toEqual([]);
  });
});

describe('resolveStepArgs', () => {
  const results = new Map<number, Record<string, unknown> | null>([
    [0, { items: [{ id: 'lead-1' }, { id: 'lead-2' }], meta: { hasMore: false } }],
    [1, { id: 'tpl-1', name: 'Welcome' }],
  ]);

  it('substitutes scalar refs', () => {
    expect(resolveStepArgs({ templateId: '$steps.1.id' }, results)).toEqual({
      templateId: 'tpl-1',
    });
  });

  it('maps wildcard refs over arrays', () => {
    expect(resolveStepArgs({ lead_ids: '$steps.0.items.*.id' }, results)).toEqual({
      lead_ids: ['lead-1', 'lead-2'],
    });
  });

  it('substitutes refs nested inside arrays of objects', () => {
    const args = { steps: [{ stepNumber: 1, templateId: '$steps.1.id' }] };
    expect(resolveStepArgs(args, results)).toEqual({
      steps: [{ stepNumber: 1, templateId: 'tpl-1' }],
    });
  });

  it('leaves ref-free args untouched', () => {
    const args = { limit: 10, tags: ['a', 'b'] };
    expect(resolveStepArgs(args, results)).toEqual(args);
  });

  it('throws when the referenced step has no result', () => {
    expect(() => resolveStepArgs({ id: '$steps.7.id' }, results)).toThrow(StepRefError);
  });

  it('throws when the path does not resolve', () => {
    expect(() => resolveStepArgs({ id: '$steps.1.missing.deep' }, results)).toThrow(StepRefError);
  });

  it('throws when * is applied to a non-array', () => {
    expect(() => resolveStepArgs({ ids: '$steps.1.id.*.x' }, results)).toThrow(StepRefError);
  });
});

describe('planSchema with step refs', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests mutate the fixture into invalid shapes
  const clonePlan = (): any => structuredClone(chainedPlan);
  const chainedPlan = {
    goal: 'Create a template then a sequence using it',
    steps: [
      {
        step_index: 0,
        action_name: 'template.create',
        action_args: { name: 'Welcome', channel: 'email', body: 'Hi {{contact_name}}' },
        risk_tier: 'sensitive_write',
        depends_on: [],
        rationale: 'The sequence needs a template.',
      },
      {
        step_index: 1,
        action_name: 'sequence.create',
        action_args: {
          name: 'Onboarding',
          steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: '$steps.0.id' }],
        },
        risk_tier: 'sensitive_write',
        depends_on: [0],
        rationale: 'Create the sequence referencing the new template.',
      },
    ],
  };

  it('accepts a plan whose later step references an earlier step output', () => {
    const result = planSchema.safeParse(chainedPlan);
    expect(result.success).toBe(true);
  });

  it('rejects a ref to a step not declared in depends_on', () => {
    const plan = clonePlan();
    plan.steps[1].depends_on = [];
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.success ? {} : result.error.issues)).toContain('depends_on');
  });

  it('rejects a self-referential ref', () => {
    const plan = clonePlan();
    plan.steps[1].action_args.steps[0].templateId = '$steps.1.id';
    plan.steps[1].depends_on = [1];
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('still validates args fully when a step has no refs', () => {
    const plan = clonePlan();
    // invalid: sequence step missing required nested fields, no refs anywhere
    plan.steps[1].action_args = { name: 'Onboarding', steps: [{ stepNumber: 1 }] };
    const result = planSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});
