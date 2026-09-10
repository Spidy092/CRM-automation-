import {
  evaluateWorkflowCondition,
  resolveWorkflowNextNode,
  validateWorkflowDefinition,
} from './workflow.engine';
import type { WorkflowDefinition } from './workflow.types';

describe('workflow engine', () => {
  const context = {
    lead: { score: 82, country: 'IN', tags: ['hot', 'demo'] },
    message: { replied: false },
  };

  it('evaluates nested all/any/not conditions and dotted fields', () => {
    expect(
      evaluateWorkflowCondition(
        {
          all: [
            { field: 'lead.score', operator: 'gte', value: 80 },
            {
              any: [
                { field: 'lead.country', operator: 'eq', value: 'US' },
                { field: 'lead.country', operator: 'eq', value: 'IN' },
              ],
            },
            { not: { field: 'message.replied', operator: 'eq', value: true } },
          ],
        },
        context,
      ),
    ).toBe(true);
  });

  it('returns false for unsupported type comparisons instead of coercing data', () => {
    expect(
      evaluateWorkflowCondition({ field: 'lead.score', operator: 'contains', value: '8' }, context),
    ).toBe(false);
    expect(
      evaluateWorkflowCondition({ field: 'lead.score', operator: 'gt', value: '80' }, context),
    ).toBe(false);
  });

  it('supports membership, existence, and string operators', () => {
    expect(
      evaluateWorkflowCondition(
        { field: 'lead.country', operator: 'in', value: ['IN', 'US'] },
        context,
      ),
    ).toBe(true);
    expect(evaluateWorkflowCondition({ field: 'lead.missing', operator: 'exists' }, context)).toBe(
      false,
    );
    expect(
      evaluateWorkflowCondition(
        { field: 'lead.country', operator: 'starts_with', value: 'I' },
        context,
      ),
    ).toBe(true);
  });

  it('routes condition nodes through explicit true and false branches', () => {
    const condition = {
      id: 'condition',
      type: 'condition' as const,
      next: [],
      branches: { true: 'qualified', false: 'nurture' },
      condition: { field: 'lead.score', operator: 'gte' as const, value: 80 },
    };
    expect(resolveWorkflowNextNode(condition, context)).toBe('qualified');
    expect(resolveWorkflowNextNode(condition, { lead: { score: 40 } })).toBe('nurture');
    expect(resolveWorkflowNextNode({ ...condition, branches: undefined }, context)).toBeNull();
  });

  it('reports unknown edges, missing node configuration, and unreachable nodes', () => {
    const definition: WorkflowDefinition = {
      name: 'Broken workflow',
      entryNodeId: 'trigger',
      nodes: [
        { id: 'trigger', type: 'trigger', next: ['action'], trigger: { event: 'lead.created' } },
        { id: 'action', type: 'action', next: ['missing'] },
        { id: 'orphan', type: 'end', next: [] },
      ],
    };
    const issues = validateWorkflowDefinition(definition);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Unknown target node 'missing'." }),
        expect.objectContaining({ message: 'Action node requires action configuration.' }),
        expect.objectContaining({ message: 'Node is unreachable from entryNodeId.' }),
      ]),
    );
  });

  it('rejects cycles and an invalid entry node', () => {
    const definition: WorkflowDefinition = {
      name: 'Cyclic workflow',
      entryNodeId: 'action',
      nodes: [
        { id: 'trigger', type: 'trigger', next: ['action'], trigger: { event: 'lead.created' } },
        {
          id: 'action',
          type: 'action',
          next: ['trigger'],
          action: { type: 'lead.add_tag', input: { tag: 'x' } },
        },
      ],
    };
    const issues = validateWorkflowDefinition(definition);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Entry node must be a trigger.' }),
        expect.objectContaining({ message: 'Workflow graph must be acyclic.' }),
      ]),
    );
  });

  it('requires explicit branches for condition nodes and validates their targets', () => {
    const definition: WorkflowDefinition = {
      name: 'Branching workflow',
      entryNodeId: 'trigger',
      nodes: [
        { id: 'trigger', type: 'trigger', next: ['condition'], trigger: { event: 'lead.created' } },
        {
          id: 'condition',
          type: 'condition',
          next: [],
          condition: { field: 'lead.score', operator: 'gte', value: 70 },
          branches: { true: 'qualified', false: 'missing' },
        },
        { id: 'qualified', type: 'end', next: [] },
      ],
    };
    expect(validateWorkflowDefinition(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "Unknown target node 'missing'." }),
      ]),
    );
    expect(
      validateWorkflowDefinition({
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === 'condition' ? { ...node, branches: undefined } : node,
        ),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'Condition node requires true and false branches.' }),
      ]),
    );
  });

  it('rejects unsupported fan-out from non-condition nodes', () => {
    const issues = validateWorkflowDefinition({
      name: 'Fan-out workflow',
      entryNodeId: 'trigger',
      nodes: [
        {
          id: 'trigger',
          type: 'trigger',
          next: ['first', 'second'],
          trigger: { event: 'lead.created' },
        },
        { id: 'first', type: 'end', next: [] },
        { id: 'second', type: 'end', next: [] },
      ],
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Only condition nodes may have more than one outgoing edge.',
        }),
      ]),
    );
  });
});
