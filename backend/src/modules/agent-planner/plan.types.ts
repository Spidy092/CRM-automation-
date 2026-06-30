import type { z } from 'zod';
import type { AgentActionName, AgentRiskTier } from '../agent/agent.types';
import type { planSchema } from './plan.schema';

export type Plan = z.infer<typeof planSchema>;
export type PlanStep = Plan['steps'][number];

export type PlanStatus =
  | 'proposed'
  | 'approved'
  | 'running'
  | 'paused_for_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PlanStepStatus =
  | 'pending'
  | 'running'
  | 'pending_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type AutonomyLevel = 'supervised' | 'guarded' | 'autopilot';
export type PlanSource = 'chat' | 'event' | 'manual';

export interface PlanRow {
  id: string;
  conversation_id: string | null;
  goal: string;
  status: PlanStatus;
  autonomy_level: AutonomyLevel | null;
  confidence: number | null;
  source: PlanSource;
  requested_by: string | null;
  source_message: string | null;
  cost_cap_cents: number;
  step_cap: number;
  cost_used_cents: number;
  deadline_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
}

export interface PlanStepRow {
  id: string;
  plan_id: string;
  step_index: number;
  action_name: AgentActionName;
  action_args: Record<string, unknown>;
  risk_tier: AgentRiskTier;
  depends_on: number[];
  rationale: string;
  status: PlanStepStatus;
  agent_action_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreatePlanInput {
  conversationId?: string | null;
  goal: string;
  autonomyLevel?: AutonomyLevel | null;
  confidence?: number | null;
  source: PlanSource;
  requestedBy?: string | null;
  sourceMessage?: string | null;
  steps: PlanStep[];
  idempotencyKey: string;
  expiresAt?: string | null;
}

export interface CreatePlanStepInput {
  planId: string;
  stepIndex: number;
  actionName: AgentActionName;
  actionArgs: Record<string, unknown>;
  riskTier: AgentRiskTier;
  dependsOn: number[];
  rationale: string;
}
