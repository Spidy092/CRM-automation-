import type { AgentPolicyContext, AgentPolicyDecision } from './agent.types';
import { getAgentActionDefinition } from './agent.actions';

export function evaluateAgentPolicy(context: AgentPolicyContext): AgentPolicyDecision {
  const definition = getAgentActionDefinition(context.actionName);
  const actorRole = context.actor?.role;

  if (!actorRole || !definition.allowedRoles.includes(actorRole)) {
    return { outcome: 'reject', reason: 'Role is not allowed to perform this action' };
  }

  if (definition.riskTier === 'unsupported') {
    return { outcome: 'reject', reason: 'Action is not supported by the agent harness' };
  }

  if (definition.riskTier === 'read' || definition.riskTier === 'compliance_critical') {
    return { outcome: 'execute_now', reason: 'Read or compliance-critical action' };
  }

  if (context.source === 'chat') {
    return approval(context, 'Chat write actions require explicit approval');
  }

  if (context.autonomyLevel === 'supervised') {
    return approval(context, 'Campaign is supervised');
  }

  if (definition.riskTier === 'low_risk_write') {
    return { outcome: 'execute_now', reason: 'Low-risk write allowed' };
  }

  if (context.autonomyLevel === 'autopilot') {
    const threshold = context.aiMinConfidence ?? 70;
    if ((context.confidence ?? 0) >= threshold && definition.riskTier === 'customer_facing_write') {
      return { outcome: 'execute_now', reason: 'Autopilot confidence threshold met' };
    }
  }

  return approval(context, 'Action requires human approval');
}

function approval(context: AgentPolicyContext, reason: string): AgentPolicyDecision {
  const assignTo = context.assignTo ?? context.actor?.id;
  if (!assignTo) {
    return { outcome: 'reject', reason: `${reason}; no approver could be resolved` };
  }
  return { outcome: 'require_approval', reason, assignTo };
}
