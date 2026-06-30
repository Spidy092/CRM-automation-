import type { AuthenticatedUser, UserRole } from '../../shared/types';

export type AgentActionSource =
  | 'chat'
  | 'event'
  | 'ai_reply'
  | 'ai_decision'
  | 'ai_campaign_brain'
  | 'expiry'
  | 'manual';

export type AgentRiskTier =
  | 'read'
  | 'low_risk_write'
  | 'customer_facing_write'
  | 'sensitive_write'
  | 'compliance_critical'
  | 'unsupported';

export type AgentActionStatus =
  | 'proposed'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type AgentActionName =
  | 'lead.list'
  | 'lead.get'
  | 'lead.create'
  | 'lead.update'
  | 'lead.pause'
  | 'pipeline.move_lead'
  | 'campaign.list'
  | 'campaign.pause'
  | 'campaign.resume'
  | 'campaign.launch'
  | 'campaign.stats'
  | 'assignment.override'
  | 'report.dashboard'
  | 'scraper.run'
  | 'outreach.send_manual'
  | 'ai.decision.recompute'
  | 'ai.inbox.action';

export interface AgentActor {
  id: string;
  role: UserRole;
  email?: string;
  name?: string;
  ipAddress?: string | null;
}

export function toAgentActor(
  user: AuthenticatedUser,
  ipAddress?: string | null,
): AgentActor {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    ipAddress: ipAddress ?? null,
  };
}

export interface AgentActionRow {
  id: string;
  source: AgentActionSource;
  action_name: AgentActionName;
  action_args: Record<string, unknown>;
  risk_tier: AgentRiskTier;
  status: AgentActionStatus;
  requested_by: string | null;
  requester_role: UserRole | null;
  requester_email: string | null;
  requester_name: string | null;
  approved_by: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  confidence: number | null;
  autonomy_level: string | null;
  idempotency_key: string;
  result: Record<string, unknown> | null;
  error_message: string | null;
  source_message: string | null;
  expires_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentActionInput {
  source: AgentActionSource;
  actionName: AgentActionName;
  actionArgs: Record<string, unknown>;
  riskTier: AgentRiskTier;
  status: AgentActionStatus;
  requestedBy?: string | null;
  requesterRole?: UserRole | null;
  requesterEmail?: string | null;
  requesterName?: string | null;
  approvedBy?: string | null;
  leadId?: string | null;
  campaignId?: string | null;
  confidence?: number | null;
  autonomyLevel?: string | null;
  idempotencyKey: string;
  sourceMessage?: string | null;
  expiresAt?: string | null;
}

export interface AgentPolicyContext {
  actionName: AgentActionName;
  riskTier: AgentRiskTier;
  actor: AgentActor | null;
  source: AgentActionSource;
  autonomyLevel?: 'supervised' | 'guarded' | 'autopilot' | null;
  aiMinConfidence?: number | null;
  confidence?: number | null;
  assignTo?: string | null;
}

export type AgentPolicyDecision =
  | { outcome: 'execute_now'; reason: string }
  | { outcome: 'require_approval'; reason: string; assignTo: string }
  | { outcome: 'reject'; reason: string };

export interface AgentActionDefinition<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  name: AgentActionName;
  description: string;
  riskTier: AgentRiskTier;
  allowedRoles: UserRole[];
  schema: { parse: (value: unknown) => TArgs };
  entity: (args: TArgs) => { leadId?: string | null; campaignId?: string | null };
  execute: (args: TArgs, actor: AgentActor) => Promise<unknown>;
}

export interface ProposeAgentActionInput {
  source: AgentActionSource;
  actionName: AgentActionName;
  args: Record<string, unknown>;
  actor: AgentActor | null;
  sourceMessage?: string | null;
  confidence?: number | null;
  autonomyLevel?: 'supervised' | 'guarded' | 'autopilot' | null;
  aiMinConfidence?: number | null;
  assignTo?: string | null;
  expiresAt?: string | null;
  forceApproval?: boolean;
}

export interface AgentActionProposalResult {
  policy: AgentPolicyDecision;
  action: AgentActionRow | null;
  result?: unknown;
}

export interface ExecuteAgentActionOptions {
  approvedBy?: string | null;
  actor?: AgentActor | null;
  source?: AgentActionSource;
}
