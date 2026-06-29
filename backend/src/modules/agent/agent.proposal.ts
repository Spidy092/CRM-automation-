import crypto from 'crypto';
import { createItem } from '../ai-inbox/ai-inbox.service';
import type { AiInboxItemType } from '../ai-inbox/ai-inbox.types';
import { incAgentAction } from '../../shared/utils/metrics';
import { getAgentActionDefinition } from './agent.actions';
import { executeAgentAction } from './agent.executor';
import { logAgentDecision } from './agent.decision-log';
import { evaluateAgentPolicy } from './agent.policy';
import { createAgentAction } from './agent.repository';
import type {
  AgentActionProposalResult,
  ProposeAgentActionInput,
} from './agent.types';

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function buildIdempotencyKey(input: {
  source: string;
  actionName: string;
  args: Record<string, unknown>;
  actorId?: string | null;
  sourceMessage?: string | null;
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${input.source}:${input.actionName}:${input.actorId ?? 'system'}:${stableJson(input.args)}:${input.sourceMessage ?? ''}`)
    .digest('hex');
  return `agent:${hash}`;
}

export async function proposeAgentAction(
  input: ProposeAgentActionInput,
): Promise<AgentActionProposalResult> {
  const definition = getAgentActionDefinition(input.actionName);
  const args = definition.schema.parse(input.args);
  const entity = definition.entity(args);
  const policy = input.forceApproval
    ? requireApproval(input)
    : evaluateAgentPolicy({
        actionName: input.actionName,
        riskTier: definition.riskTier,
        actor: input.actor,
        source: input.source,
        autonomyLevel: input.autonomyLevel,
        aiMinConfidence: input.aiMinConfidence,
        confidence: input.confidence,
        assignTo: input.assignTo,
      });

  if (policy.outcome === 'reject') {
    incAgentAction({
      source: input.source,
      action: input.actionName,
      status: 'rejected',
      riskTier: definition.riskTier,
    });
    await logAgentDecision({
      actionName: input.actionName,
      source: input.source,
      decision: 'rejected',
      reason: policy.reason,
      entity,
      confidence: input.confidence ?? null,
      autonomyLevel: input.autonomyLevel ?? null,
      humanApprovalRequired: false,
      inputContext: { actorRole: input.actor?.role ?? null, riskTier: definition.riskTier },
    });
    return { policy, action: null };
  }

  const action = await createAgentAction({
    source: input.source,
    actionName: input.actionName,
    actionArgs: args,
    riskTier: definition.riskTier,
    status: policy.outcome === 'require_approval' ? 'pending_approval' : 'proposed',
    requestedBy: input.actor?.id ?? null,
    requesterRole: input.actor?.role ?? null,
    requesterEmail: input.actor?.email ?? null,
    requesterName: input.actor?.name ?? null,
    leadId: entity.leadId ?? null,
    campaignId: entity.campaignId ?? null,
    confidence: input.confidence ?? null,
    autonomyLevel: input.autonomyLevel ?? null,
    idempotencyKey: buildIdempotencyKey({
      source: input.source,
      actionName: input.actionName,
      args,
      actorId: input.actor?.id,
      sourceMessage: input.sourceMessage,
    }),
    sourceMessage: input.sourceMessage ?? null,
    expiresAt: input.expiresAt ?? null,
  });

  incAgentAction({
    source: action.source,
    action: action.action_name,
    status: action.status,
    riskTier: action.risk_tier,
  });
  await logAgentDecision({
    actionName: action.action_name,
    source: action.source,
    decision: action.status,
    reason: policy.reason,
    entity,
    confidence: input.confidence ?? null,
    autonomyLevel: input.autonomyLevel ?? null,
    humanApprovalRequired: policy.outcome === 'require_approval',
    inputContext: { actorRole: input.actor?.role ?? null, riskTier: action.risk_tier, agentActionId: action.id },
  });

  if (policy.outcome === 'require_approval') {
    await createItem({
      assigned_to: policy.assignTo,
      lead_id: action.lead_id ?? undefined,
      campaign_id: action.campaign_id ?? undefined,
      item_type: inboxTypeForAction(action.action_name),
      title: approvalTitle(action.action_name),
      summary: policy.reason,
      urgency_score: urgencyForRisk(action.risk_tier),
      ai_draft_response: input.sourceMessage ?? undefined,
      ai_draft_confidence: input.confidence ?? undefined,
      expires_at: input.expiresAt ?? undefined,
      agent_action_id: action.id,
    });
    return { policy, action };
  }

  const executed = await executeAgentAction(action.id, { actor: input.actor, source: input.source });
  return { policy, action: executed, result: executed.result };
}

export function requireApproval(input: ProposeAgentActionInput) {
  const assignTo = input.assignTo ?? input.actor?.id;
  if (!assignTo) return { outcome: 'reject' as const, reason: 'No approver could be resolved' };
  return { outcome: 'require_approval' as const, reason: 'Explicit approval required', assignTo };
}

export function inboxTypeForAction(actionName: string): AiInboxItemType {
  if (actionName.startsWith('campaign.')) return 'campaign_review';
  if (actionName.startsWith('outreach.')) return 'approve_response';
  if (actionName.startsWith('assignment.')) return 'lead_handoff';
  return 'approve_response';
}

export function approvalTitle(actionName: string): string {
  return `Approve agent action: ${actionName}`;
}

export function urgencyForRisk(riskTier: string): number {
  if (riskTier === 'customer_facing_write') return 80;
  if (riskTier === 'sensitive_write') return 70;
  if (riskTier === 'low_risk_write') return 45;
  return 60;
}
