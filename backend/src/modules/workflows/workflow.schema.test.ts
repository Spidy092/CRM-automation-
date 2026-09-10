import {
  createWorkflowSchema,
  workflowDefinitionSchema,
  workflowIdParamSchema,
} from './workflow.schema';

const validDefinition = {
  name: 'New lead follow-up',
  entryNodeId: 'trigger',
  nodes: [
    {
      id: 'trigger',
      type: 'trigger' as const,
      next: ['condition'],
      trigger: {
        event: 'lead.created' as const,
        filters: {
          all: [
            { field: 'source_platform', operator: 'eq' as const, value: 'website' },
            { field: 'lead_score', operator: 'gte' as const, value: 70 },
          ],
        },
      },
    },
    {
      id: 'condition',
      type: 'condition' as const,
      next: [],
      branches: { true: 'qualified', false: 'nurture' },
      condition: { field: 'status', operator: 'eq' as const, value: 'active' },
    },
    { id: 'qualified', type: 'end' as const, next: [] },
    { id: 'nurture', type: 'end' as const, next: [] },
  ],
};

describe('workflow schemas', () => {
  it('accepts nested conditions and valid graph nodes', () => {
    expect(workflowDefinitionSchema.safeParse(validDefinition).success).toBe(true);
  });

  it('rejects unknown node fields and unsupported trigger events', () => {
    expect(
      workflowDefinitionSchema.safeParse({
        ...validDefinition,
        nodes: [{ ...validDefinition.nodes[2], unexpected: true }],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        ...validDefinition,
        nodes: [
          {
            ...validDefinition.nodes[0],
            trigger: { event: 'contact.deleted' },
          },
          ...validDefinition.nodes.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('enforces node and condition collection bounds', () => {
    const tooManyNodes = Array.from({ length: 101 }, (_, index) => ({
      id: `node-${index}`,
      type: 'end' as const,
      next: [],
    }));
    expect(
      workflowDefinitionSchema.safeParse({
        ...validDefinition,
        nodes: tooManyNodes,
      }).success,
    ).toBe(false);

    expect(
      workflowDefinitionSchema.safeParse({
        ...validDefinition,
        nodes: [
          {
            ...validDefinition.nodes[0],
            trigger: {
              event: 'lead.created' as const,
              filters: { all: [] },
            },
          },
          ...validDefinition.nodes.slice(1),
        ],
      }).success,
    ).toBe(false);
  });

  it('requires the top-level and graph names to match on create', () => {
    expect(
      createWorkflowSchema.safeParse({
        name: 'Different name',
        definition: validDefinition,
      }).success,
    ).toBe(false);
  });

  it('requires UUID workflow route parameters', () => {
    expect(workflowIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
    expect(
      workflowIdParamSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success,
    ).toBe(true);
  });
});
