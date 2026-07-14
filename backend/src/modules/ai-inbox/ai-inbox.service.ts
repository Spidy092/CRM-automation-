import { logger } from '../../shared/utils/logger';
import { AppError } from '../../shared/middleware/errorHandler';
import { incAiInboxItem } from '../../shared/utils/metrics';
import { executeAgentAction, rejectAgentAction } from '../agent/agent.service';
import type { AgentActor } from '../agent/agent.types';
import { continuePlanIfReady } from '../agent-planner/runner.service';
import { findPlanStepById, updatePlanStepStatus } from '../agent-planner/plan.repository';
import {
  createInboxItem,
  findInboxItems,
  findInboxItemById,
  findPendingInboxItemByAgentActionId,
  actionInboxItem,
  countInboxItems,
  expireGuardedItems,
  setInboxActionResult,
  autoResolveItemsForLead as repoAutoResolveItemsForLead,
} from './ai-inbox.repository';
import type { AiInboxItem, CreateInboxItemInput, ListInboxItemsOptions } from './ai-inbox.types';

export async function createItem(input: CreateInboxItemInput): Promise<AiInboxItem> {
  const item = await createInboxItem(input);
  incAiInboxItem(item.item_type, 'created');
  logger.info('ai inbox: item created', {
    id: item.id,
    type: item.item_type,
    assignedTo: item.assigned_to,
    urgency: item.urgency_score,
    agentActionId: item.agent_action_id,
  });
  return item;
}

export async function listItems(opts: ListInboxItemsOptions): Promise<{
  items: AiInboxItem[];
  total: number;
}> {
  const [items, total] = await Promise.all([
    findInboxItems(opts),
    countInboxItems(opts.assigned_to),
  ]);
  return { items, total };
}

export async function findPendingItemForAgentAction(
  agentActionId: string,
): Promise<AiInboxItem | null> {
  return findPendingInboxItemByAgentActionId(agentActionId);
}

export async function actionItem(
  id: string,
  actor: AgentActor,
  action: 'approve' | 'reject' | 'snooze',
  snoozedUntil?: string,
  idempotencyKey?: string,
): Promise<AiInboxItem> {
  const existing = await findInboxItemById(id);
  if (!existing) throw new AppError(`Inbox item not found: ${id}`, 404);

  // Double-click protection: if an idempotency_key is supplied and the same
  // actor already actioned this item within the last 5 seconds, return the
  // existing record instead of re-executing.
  if (idempotencyKey && existing.actioned_at) {
    const elapsedMs = Date.now() - new Date(existing.actioned_at).getTime();
    if (elapsedMs >= 0 && elapsedMs < 5000 && existing.actioned_by === actor.id) {
      logger.info('ai inbox: idempotent action short-circuited', {
        id,
        action,
        idempotencyKey,
        actionedAt: existing.actioned_at,
        elapsedMs,
      });
      return existing;
    }
  }

  if (action === 'reject' && existing.agent_action_id) {
    await rejectAgentAction(existing.agent_action_id, actor.id);
  }

  const statusMap = { approve: 'actioned', reject: 'actioned', snooze: 'snoozed' } as const;

  let updated = await actionInboxItem(id, {
    status: statusMap[action],
    actioned_by: actor.id,
    snoozed_until: action === 'snooze' ? snoozedUntil : undefined,
  });

  if (!updated) throw new AppError(`Failed to action inbox item: ${id}`, 500);

  if (action === 'approve' && existing.agent_action_id) {
    const executed = await executeAgentAction(existing.agent_action_id, {
      approvedBy: actor.id,
      actor,
    });
    updated = await setInboxActionResult(id, {
      agentActionId: executed.id,
      status: executed.status,
      result: executed.result,
    });
    if (!updated) throw new AppError(`Failed to update inbox action result: ${id}`, 500);

    // If this inbox item is linked to a plan, update the plan step status and resume the runner
    if (existing.agent_plan_id) {
      if (existing.agent_plan_step_id) {
        const step = await findPlanStepById(existing.agent_plan_step_id);
        if (step) {
          await updatePlanStepStatus(step.id, 'succeeded', {
            result: (executed.result as Record<string, unknown> | undefined) ?? null,
            agentActionId: executed.id,
            completedAt: new Date().toISOString(),
          });
        }
      }
      await continuePlanIfReady(existing.agent_plan_id).catch((err) =>
        logger.error('ai inbox: failed to resume plan after approval', {
          planId: existing.agent_plan_id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  incAiInboxItem(updated.item_type, action);
  logger.info('ai inbox: item actioned', {
    id,
    action,
    userId: actor.id,
    type: updated.item_type,
    agentActionId: updated.agent_action_id,
  });

  return updated;
}

/**
 * Auto-resolve all pending inbox items for a lead when an action is taken elsewhere
 * (e.g. lead paused, opt-out detected, or stage changed). Exposes the repository
 * helper to callers that have a leadId in scope.
 */
export async function autoResolveItemsForLead(leadId: string): Promise<void> {
  await repoAutoResolveItemsForLead(leadId);
}

/**
 * Run expiry sweep for guarded-mode approve_response items.
 * Expired items execute only when they have a linked agent action; otherwise
 * they are simply marked actioned for legacy compatibility.
 */
export async function runExpirySweep(): Promise<number> {
  const expired = await expireGuardedItems();

  for (const item of expired) {
    if (item.agent_action_id) {
      try {
        const executed = await executeAgentAction(item.agent_action_id, { source: 'expiry' });
        await setInboxActionResult(item.id, {
          agentActionId: executed.id,
          status: executed.status,
          result: executed.result,
        });
      } catch (err) {
        logger.error('ai inbox: guarded item expiry execution failed', {
          id: item.id,
          agentActionId: item.agent_action_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    incAiInboxItem('approve_response', 'auto_resolved');
    logger.info('ai inbox: guarded item auto-actioned on expiry', {
      id: item.id,
      leadId: item.lead_id,
      agentActionId: item.agent_action_id,
    });
  }

  return expired.length;
}
