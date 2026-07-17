import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

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

export interface LeadAiProfile {
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

export type DecisionType = 'research' | 'next_action' | 'reply_classify' | 'campaign_brief';

export interface AiDecisionLogEntry {
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

/** Returns the AI profile for a lead, or null when none exists (404). */
export const useLeadAiProfile = (leadId: string) => {
  return useQuery({
    queryKey: ['ai-profile', leadId],
    queryFn: async (): Promise<LeadAiProfile | null> => {
      try {
        const { data } = await api.get<{ data: LeadAiProfile }>(
          `/ai-intelligence/leads/${leadId}/profile`,
        );
        return data.data;
      } catch (err: unknown) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    enabled: !!leadId,
  });
};

export const useLeadDecisions = (leadId: string, limit = 20) => {
  return useQuery({
    queryKey: ['ai-lead-decisions', leadId, limit],
    queryFn: async (): Promise<AiDecisionLogEntry[]> => {
      const { data } = await api.get<{ data: AiDecisionLogEntry[] }>(
        `/ai-intelligence/leads/${leadId}/decisions`,
        { params: { limit } },
      );
      return data.data;
    },
    enabled: !!leadId,
  });
};

/** Manually (re-)triggers AI research for a lead. */
export const useTriggerLeadResearch = (leadId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.post(`/ai-intelligence/leads/${leadId}/research`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-profile', leadId] });
    },
  });
};

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 404
  );
}
