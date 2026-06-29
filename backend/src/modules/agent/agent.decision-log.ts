import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { logger } from '../../shared/utils/logger';

export async function logAgentDecision(input: {
  actionName: string;
  source: string;
  decision: string;
  reason: string;
  entity: { leadId?: string | null; campaignId?: string | null };
  confidence?: number | null;
  autonomyLevel?: string | null;
  humanApprovalRequired: boolean;
  inputContext: Record<string, unknown>;
}): Promise<void> {
  await insertDecisionLog({
    lead_id: input.entity.leadId ?? null,
    campaign_id: input.entity.campaignId ?? null,
    decision_type: input.source === 'chat' ? 'chat' : 'agent_action',
    input_context: {
      ...input.inputContext,
      source: input.source,
      actionName: input.actionName,
    },
    chain_of_thought: input.reason,
    decision: input.decision,
    confidence: input.confidence ?? null,
    autonomy_level: input.autonomyLevel ?? null,
    human_approval_required: input.humanApprovalRequired,
  }).catch((err: unknown) => {
    logger.warn('agent action decision log failed', {
      actionName: input.actionName,
      decision: input.decision,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
