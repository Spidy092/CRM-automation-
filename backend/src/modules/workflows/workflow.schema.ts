import { z } from 'zod';
import type {
  WorkflowActionType,
  WorkflowComparisonOperator,
  WorkflowNodeType,
  WorkflowTriggerType,
} from './workflow.types';

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const comparisonOperators = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'exists',
] as const satisfies readonly WorkflowComparisonOperator[];

const triggerTypes = [
  'lead.created',
  'lead.updated',
  'lead.stage_changed',
  'lead.tag_added',
  'form.submitted',
  'message.event',
  'booking.created',
  'booking.cancelled',
  'webhook.received',
  'schedule.reached',
] as const satisfies readonly WorkflowTriggerType[];

const actionTypes = [
  'lead.update',
  'lead.add_tag',
  'lead.remove_tag',
  'lead.assign',
  'pipeline.move',
  'task.create',
  'message.send',
  'sequence.enroll',
  'notification.send',
  'webhook.call',
] as const satisfies readonly WorkflowActionType[];

export const workflowConditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({
      field: z.string().min(1).max(255),
      operator: z.enum(comparisonOperators),
      value: z.union([scalarSchema, z.array(scalarSchema).max(100)]).optional(),
    }),
    z.object({ all: z.array(workflowConditionSchema).min(1).max(50) }),
    z.object({ any: z.array(workflowConditionSchema).min(1).max(50) }),
    z.object({ not: workflowConditionSchema }),
  ]),
);

const nodeTypeSchema = z.enum(['trigger', 'condition', 'action', 'wait', 'goal', 'end'] as [
  WorkflowNodeType,
  ...WorkflowNodeType[],
]);

export const workflowNodeSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9_-]+$/),
    type: nodeTypeSchema,
    next: z.array(z.string().min(1).max(80)).max(20),
    branches: z
      .object({
        true: z.string().min(1).max(80),
        false: z.string().min(1).max(80),
      })
      .strict()
      .optional(),
    trigger: z
      .object({
        event: z.enum(triggerTypes),
        filters: workflowConditionSchema.optional(),
      })
      .optional(),
    condition: workflowConditionSchema.optional(),
    action: z
      .object({
        type: z.enum(actionTypes),
        input: z.record(z.union([scalarSchema, z.array(scalarSchema).max(100)])),
      })
      .optional(),
    waitMinutes: z.number().int().min(1).max(43_200).optional(),
    goal: workflowConditionSchema.optional(),
  })
  .strict();

export const workflowDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2_000).nullable().optional(),
  entryNodeId: z.string().min(1).max(80),
  nodes: z.array(workflowNodeSchema).min(2).max(100),
});

export type WorkflowDefinitionInput = z.infer<typeof workflowDefinitionSchema>;

export const createWorkflowSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2_000).nullable().optional(),
    definition: workflowDefinitionSchema,
  })
  .superRefine((value, ctx) => {
    if (value.definition.name !== value.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['definition', 'name'],
        message: 'Definition name must match workflow name',
      });
    }
  });

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export const workflowIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const workflowExecutionJobSchema = z.object({
  enrollmentId: z.string().uuid(),
});

export type WorkflowExecutionJobInput = z.infer<typeof workflowExecutionJobSchema>;
