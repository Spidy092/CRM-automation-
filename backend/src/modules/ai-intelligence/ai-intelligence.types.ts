export type BuyingIntent = 'high' | 'medium' | 'low' | 'unknown';
export type PreferredChannel = 'whatsapp' | 'email' | 'sms';
export type EnrichmentStatus = 'pending' | 'running' | 'done' | 'failed';
export type NextBestAction =
  | 'send_whatsapp'
  | 'send_email'
  | 'send_sms'
  | 'wait_and_followup'
  | 'call'
  | 'move_to_nurture'
  | 'escalate_to_rep'
  | 'request_human_approval'
  | 'disqualify'
  | 'request_review';

export type DecisionType = 'research' | 'next_action' | 'reply_classify' | 'campaign_brief' | 'chat' | 'agent_action';

export interface LeadAiProfileRow {
  id: string;
  lead_id: string;
  website_quality_score: number | null;
  pain_points: string[];
  offer_angle: string | null;
  inferred_budget_range: string | null;
  buying_intent: BuyingIntent;
  reachability_score: number | null;
  buying_signals: Array<{ signal: string; detected_at: string }>;
  objection_log: Array<{ type: string; text: string; logged_at: string }>;
  do_not_say: string[];
  preferred_channel: PreferredChannel | null;
  preferred_time_of_day: string | null;
  conversation_summary: string | null;
  ai_notes: string | null;
  next_best_action: NextBestAction | null;
  next_best_action_reason: string | null;
  next_best_action_confidence: number | null;
  enrichment_status: EnrichmentStatus;
  last_enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiDecisionLogRow {
  id: string;
  lead_id: string | null;
  campaign_id: string | null;
  decision_type: DecisionType;
  input_context: Record<string, unknown>;
  chain_of_thought: string | null;
  decision: string;
  confidence: number | null;
  tokens_used: number | null;
  latency_ms: number | null;
  model_used: string | null;
  autonomy_level: string | null;
  human_approval_required: boolean;
  human_approved_by: string | null;
  human_approved_at: string | null;
  created_at: string;
}

/** Shape returned by OpenAI for a research call — validated with Zod at runtime. */
export interface AiResearchOutput {
  pain_points: string[];
  offer_angle: string;
  buying_intent: BuyingIntent;
  reachability_score: number;
  website_quality_score: number;
  inferred_budget_range: 'low' | 'medium' | 'high' | 'unknown';
  preferred_channel: PreferredChannel;
  ai_notes: string;
  next_best_action: NextBestAction;
  next_best_action_reason: string;
  next_best_action_confidence: number;
  chain_of_thought: string;
}

export interface UpsertAiProfileInput {
  lead_id: string;
  website_quality_score?: number | null;
  pain_points?: string[];
  offer_angle?: string | null;
  inferred_budget_range?: string | null;
  buying_intent?: BuyingIntent;
  reachability_score?: number | null;
  preferred_channel?: PreferredChannel | null;
  ai_notes?: string | null;
  next_best_action?: NextBestAction | null;
  next_best_action_reason?: string | null;
  next_best_action_confidence?: number | null;
  enrichment_status: EnrichmentStatus;
  last_enriched_at?: string | null;
}

export interface InsertDecisionLogInput {
  lead_id?: string | null;
  campaign_id?: string | null;
  decision_type: DecisionType;
  input_context: Record<string, unknown>;
  chain_of_thought?: string | null;
  decision: string;
  confidence?: number | null;
  tokens_used?: number | null;
  latency_ms?: number | null;
  model_used?: string | null;
  autonomy_level?: string | null;
  human_approval_required?: boolean;
}
