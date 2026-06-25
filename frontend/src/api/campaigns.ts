import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type OutreachTone = 'formal' | 'professional' | 'conversational';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  tone: OutreachTone;
  target_industries: string[];
  target_countries: string[];
  sequence_id: string | null;
  pipeline_id: string | null;
  ai_personalization_enabled: boolean;
  created_by: string;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStats {
  total_leads: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
}

export interface AutomationPreview {
  campaignId: string;
  sequenceId: string | null;
  firstStep: {
    stepNumber: number;
    channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
    templateId: string;
    delayHours: number;
  } | null;
  eligibleLeads: Array<{ leadId: string; businessName: string; destination: string }>;
  skippedLeads: Array<{ leadId: string; businessName: string; reasons: string[] }>;
  templateIssues: string[];
  connectorIssues: string[];
  expectedJobs: number;
  mockMode: boolean;
}

export interface AutomationLaunchMeta {
  enqueued: number;
  skipped: number;
  mockMode: boolean;
}

export interface CreateCampaignInput {
  name: string;
  tone?: OutreachTone;
  target_industries?: string[];
  target_countries?: string[];
  sequence_id?: string;
  pipeline_id?: string;
  ai_personalization_enabled?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  tone?: OutreachTone;
  target_industries?: string[];
  target_countries?: string[];
  sequence_id?: string;
  pipeline_id?: string;
  ai_personalization_enabled?: boolean;
}

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Campaign[]>>('/campaigns');
      return response.data.data;
    },
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Campaign>>(`/campaigns/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useAutomationPreview(id: string, enabled = false) {
  return useQuery({
    queryKey: ['campaigns', id, 'automation-preview'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<AutomationPreview>>(
        `/campaigns/${id}/automation-preview`,
      );
      return response.data.data;
    },
    enabled: !!id && enabled,
  });
}

export function useCampaignStats(id: string) {
  return useQuery({
    queryKey: ['campaigns', id, 'stats'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CampaignStats>>(`/campaigns/${id}/stats`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      const response = await apiClient.post<ApiResponse<Campaign>>('/campaigns', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateCampaignInput }) => {
      const response = await apiClient.put<ApiResponse<Campaign>>(`/campaigns/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', id] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useLaunchCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Campaign>>(`/campaigns/${id}/launch`);
      return {
        campaign: response.data.data,
        automation: response.data.meta?.automation as AutomationLaunchMeta | undefined,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function usePauseCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Campaign>>(`/campaigns/${id}/pause`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useResumeCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Campaign>>(`/campaigns/${id}/resume`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useAddLeadsToCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ campaignId, leadIds }: { campaignId: string; leadIds: string[] }) => {
      const response = await apiClient.post<ApiResponse<{ added: number }>>(
        `/campaigns/${campaignId}/leads`,
        { lead_ids: leadIds }
      );
      return response.data.data;
    },
    onSuccess: (_, { campaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId, 'stats'] });
    },
  });
}
