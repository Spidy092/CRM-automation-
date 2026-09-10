import { z } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import type { UserRole } from '../../shared/types';
import { getLeadById, updateLeadFields } from '../leads/leads.service';
import { moveLead } from '../pipeline/pipeline.service';
import type { WorkflowActionConfig, WorkflowActionType, WorkflowScalar } from './workflow.types';

/**
 * The worker executes workflow actions as the user who owns the published
 * workflow. Only roles that can already make CRM mutations are allowed to
 * execute the internal action subset.
 */
export interface WorkflowActionActor {
  id: string;
  role: UserRole;
  ipAddress?: string | null;
}

export interface WorkflowActionContext {
  leadId: string;
  actor: WorkflowActionActor;
  idempotencyKey: string;
}

export interface WorkflowActionResult {
  actionType: WorkflowActionType;
  changed: boolean;
  details?: Record<string, WorkflowScalar>;
}

export class WorkflowActionError extends AppError {
  public readonly code: string;

  constructor(code: string, message: string, statusCode = 422) {
    super(message, statusCode);
    this.code = code;
    Object.setPrototypeOf(this, WorkflowActionError.prototype);
  }
}

const mutationRoles = new Set<UserRole>(['admin', 'manager']);

const leadUpdateInputSchema = z
  .object({
    notes: z.string().max(10_000).nullable().optional(),
    deal_value: z.number().finite().nullable().optional(),
    next_follow_up_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

const tagInputSchema = z.object({ tag: z.string().trim().min(1).max(100) }).strict();
const assignmentInputSchema = z.object({ user_id: z.string().uuid() }).strict();
const pipelineMoveInputSchema = z.object({ stage_id: z.string().uuid() }).strict();

function parseInput<T>(
  schema: z.ZodType<T>,
  input: Record<string, WorkflowScalar | WorkflowScalar[]>,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowActionError(
      'INVALID_ACTION_INPUT',
      parsed.error.issues[0]?.message ?? 'Workflow action input is invalid',
    );
  }
  return parsed.data;
}

function assertMutationRole(actor: WorkflowActionActor): void {
  if (!mutationRoles.has(actor.role)) {
    throw new WorkflowActionError(
      'ACTION_FORBIDDEN',
      'Only admin and manager-owned workflows may execute CRM mutations.',
      403,
    );
  }
}

function actionDisabled(actionType: WorkflowActionType): never {
  throw new WorkflowActionError(
    'ACTION_EXECUTION_DISABLED',
    `Workflow action '${actionType}' remains disabled until consent, connector authorization, and durable idempotency are configured.`,
    503,
  );
}

/**
 * Executes the provider-neutral, repeat-safe CRM mutation subset. External
 * sends, sequence enrollment, task creation, notifications, and webhooks are
 * intentionally rejected until their own policy and idempotency contracts are
 * implemented.
 */
export async function executeWorkflowAction(
  action: WorkflowActionConfig,
  context: WorkflowActionContext,
): Promise<WorkflowActionResult> {
  if (
    action.type === 'task.create' ||
    action.type === 'message.send' ||
    action.type === 'sequence.enroll' ||
    action.type === 'notification.send' ||
    action.type === 'webhook.call'
  ) {
    return actionDisabled(action.type);
  }

  assertMutationRole(context.actor);

  switch (action.type) {
    case 'lead.update': {
      const input = parseInput(leadUpdateInputSchema, action.input);
      const current = await getLeadById(context.leadId, context.actor);
      const changed = Object.entries(input).some(([key, value]) => {
        const currentValue = current[key as keyof typeof current];
        return currentValue !== value;
      });
      if (changed) await updateLeadFields(context.leadId, input, context.actor);
      return {
        actionType: action.type,
        changed,
        details: { idempotency_key: context.idempotencyKey },
      };
    }

    case 'lead.add_tag': {
      const { tag } = parseInput(tagInputSchema, action.input);
      const current = await getLeadById(context.leadId, context.actor);
      if (current.tags.includes(tag)) {
        return { actionType: action.type, changed: false, details: { tag } };
      }
      await updateLeadFields(context.leadId, { tags: [...current.tags, tag] }, context.actor);
      return { actionType: action.type, changed: true, details: { tag } };
    }

    case 'lead.remove_tag': {
      const { tag } = parseInput(tagInputSchema, action.input);
      const current = await getLeadById(context.leadId, context.actor);
      if (!current.tags.includes(tag)) {
        return { actionType: action.type, changed: false, details: { tag } };
      }
      await updateLeadFields(
        context.leadId,
        { tags: current.tags.filter((currentTag) => currentTag !== tag) },
        context.actor,
      );
      return { actionType: action.type, changed: true, details: { tag } };
    }

    case 'lead.assign': {
      const { user_id: userId } = parseInput(assignmentInputSchema, action.input);
      const current = await getLeadById(context.leadId, context.actor);
      if (current.assigned_to === userId) {
        return { actionType: action.type, changed: false, details: { assigned_to: userId } };
      }
      await updateLeadFields(context.leadId, { assigned_to: userId }, context.actor);
      return { actionType: action.type, changed: true, details: { assigned_to: userId } };
    }

    case 'pipeline.move': {
      const { stage_id: stageId } = parseInput(pipelineMoveInputSchema, action.input);
      const current = await getLeadById(context.leadId, context.actor);
      if (current.pipeline_stage_id === stageId) {
        return { actionType: action.type, changed: false, details: { stage_id: stageId } };
      }
      await moveLead(context.leadId, stageId, context.actor);
      return { actionType: action.type, changed: true, details: { stage_id: stageId } };
    }

    default:
      return actionDisabled(action.type);
  }
}
