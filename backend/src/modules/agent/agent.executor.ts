import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { incAgentAction, observeAgentActionDuration } from '../../shared/utils/metrics';
import { getAgentActionDefinition } from './agent.actions';
import { logAgentDecision } from './agent.decision-log';
import {
  claimAgentActionForExecution,
  findAgentActionById,
  updateAgentActionStatus,
} from './agent.repository';
import type { AgentActionRow, AgentActor, ExecuteAgentActionOptions } from './agent.types';

export async function executeAgentAction(
  id: string,
  options: ExecuteAgentActionOptions = {},
): Promise<AgentActionRow> {
  const existing = await findAgentActionById(id);
  if (!existing) throw new AppError('Agent action not found', 404);
  if (existing.status === 'succeeded') return existing;
  if (
    existing.status === 'rejected' ||
    existing.status === 'cancelled' ||
    existing.status === 'expired'
  ) {
    throw new AppError(`Agent action is ${existing.status}`, 400);
  }
  if (isExpired(existing.expires_at)) {
    await updateAgentActionStatus(existing.id, 'expired', {
      errorMessage: 'Agent action has expired',
    });
    throw new AppError('Agent action has expired', 400);
  }

  assertApproverCanExecute(options.actor, existing);

  const claimed = await claimAgentActionForExecution(id);
  if (!claimed) {
    const current = await findAgentActionById(id);
    if (current?.status === 'succeeded') return current;
    throw new AppError('Agent action could not be claimed for execution', 409);
  }

  const definition = getAgentActionDefinition(claimed.action_name);
  const actor = resolveExecutionActor(options.actor, claimed);
  const start = Date.now();

  try {
    const parsedArgs = definition.schema.parse(claimed.action_args);
    const result = await definition.execute(parsedArgs, actor);
    const normalized = normalizeResult(result);
    const executed = await updateAgentActionStatus(claimed.id, 'succeeded', {
      approvedBy: options.approvedBy ?? claimed.approved_by,
      result: normalized,
      errorMessage: null,
      executedAt: new Date().toISOString(),
    });

    await writeAuditLog({
      userId: actor.id,
      action: `agent.${claimed.action_name}`,
      entityType: claimed.lead_id ? 'lead' : claimed.campaign_id ? 'campaign' : 'agent_action',
      entityId: claimed.lead_id ?? claimed.campaign_id ?? claimed.id,
      newValue: {
        source: options.source ?? claimed.source,
        agentActionId: claimed.id,
        idempotencyKey: claimed.idempotency_key,
        result: normalized,
        human_approval_required:
          claimed.status === 'pending_approval' || Boolean(options.approvedBy),
        approved_by: options.approvedBy ?? claimed.approved_by,
      },
      ipAddress: actor.ipAddress ?? null,
    });

    observeAgentActionDuration(
      { action: claimed.action_name, riskTier: claimed.risk_tier },
      (Date.now() - start) / 1000,
    );
    incAgentAction({
      source: claimed.source,
      action: claimed.action_name,
      status: 'succeeded',
      riskTier: claimed.risk_tier,
    });
    await logAgentDecision({
      actionName: claimed.action_name,
      source: claimed.source,
      decision: 'succeeded',
      reason: 'Agent action executed successfully',
      entity: { leadId: claimed.lead_id, campaignId: claimed.campaign_id },
      confidence: claimed.confidence,
      autonomyLevel: claimed.autonomy_level,
      humanApprovalRequired: claimed.status === 'pending_approval' || Boolean(options.approvedBy),
      inputContext: {
        agentActionId: claimed.id,
        approvedBy: options.approvedBy ?? claimed.approved_by,
      },
    });
    return executed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('agent action execution failed', {
      id: claimed.id,
      action: claimed.action_name,
      error: message,
    });
    incAgentAction({
      source: claimed.source,
      action: claimed.action_name,
      status: 'failed',
      riskTier: claimed.risk_tier,
    });
    await updateAgentActionStatus(claimed.id, 'failed', { errorMessage: message });
    await logAgentDecision({
      actionName: claimed.action_name,
      source: claimed.source,
      decision: 'failed',
      reason: message,
      entity: { leadId: claimed.lead_id, campaignId: claimed.campaign_id },
      confidence: claimed.confidence,
      autonomyLevel: claimed.autonomy_level,
      humanApprovalRequired: claimed.status === 'pending_approval' || Boolean(options.approvedBy),
      inputContext: { agentActionId: claimed.id },
    });
    throw err;
  }
}

export async function rejectAgentAction(id: string, userId: string): Promise<AgentActionRow> {
  const action = await updateAgentActionStatus(id, 'rejected', { approvedBy: userId });
  incAgentAction({
    source: action.source,
    action: action.action_name,
    status: 'rejected',
    riskTier: action.risk_tier,
  });
  return action;
}

export function normalizeResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function resolveExecutionActor(
  actor: AgentActor | null | undefined,
  action: AgentActionRow,
): AgentActor {
  if (action.requested_by && action.requester_role) {
    return {
      id: action.requested_by,
      role: action.requester_role,
      email: action.requester_email ?? undefined,
      name: action.requester_name ?? undefined,
      ipAddress: actor?.ipAddress ?? null,
    };
  }
  if (actor) return actor;
  throw new AppError('Agent action execution requires the original requester context', 400);
}

export function assertApproverCanExecute(
  approver: AgentActor | null | undefined,
  action: AgentActionRow,
): void {
  if (!approver) return;
  const definition = getAgentActionDefinition(action.action_name);
  if (!definition.allowedRoles.includes(approver.role)) {
    throw new AppError('Approver role is not allowed to approve this action', 403);
  }
}
