import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export type BriefStatus = 'draft' | 'approved' | 'rejected';

export interface SequenceStepSuggestion {
  step_number: number;
  channel: 'whatsapp' | 'email' | 'sms';
  delay_hours: number;
  goal: string;
}

export interface TemplateSuggestion {
  channel: 'whatsapp' | 'email' | 'sms';
  subject: string | null;
  body_preview: string;
}

export interface CampaignBrief {
  id: string;
  campaign_id: string;
  total_leads_evaluated: number;
  eligible_leads: number;
  high_fit_leads: number;
  segment_summary: string;
  recommended_offer_angle: string;
  expected_objections: string[];
  risk_warnings: string[];
  recommended_sequence: SequenceStepSuggestion[];
  template_suggestions: TemplateSuggestion[];
  recommended_autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  confidence_score: number;
  status: BriefStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/** Returns the campaign brief, or null when none has been generated yet (404). */
export const useCampaignBrief = (campaignId: string) => {
  return useQuery({
    queryKey: ['campaign-brief', campaignId],
    queryFn: async (): Promise<CampaignBrief | null> => {
      try {
        const { data } = await api.get<{ data: CampaignBrief }>(
          `/ai-campaign-brain/campaigns/${campaignId}/brief`,
        );
        return data.data;
      } catch (err: unknown) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    enabled: !!campaignId,
  });
};

export const useApproveBrief = (campaignId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ data: CampaignBrief }>(
        `/ai-campaign-brain/campaigns/${campaignId}/brief/approve`,
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-brief', campaignId] });
    },
  });
};

export const useRejectBrief = (campaignId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ data: CampaignBrief }>(
        `/ai-campaign-brain/campaigns/${campaignId}/brief/reject`,
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-brief', campaignId] });
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
