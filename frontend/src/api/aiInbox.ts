import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export type AiInboxItemType =
  | 'approve_response'
  | 'urgent_reply'
  | 'pricing_inquiry'
  | 'campaign_review'
  | 'lead_handoff'
  | 'objection_review';

export type AiInboxItemStatus = 'pending' | 'actioned' | 'snoozed' | 'auto_resolved';

export interface AiInboxItem {
  id: string;
  assigned_to: string;
  lead_id: string | null;
  campaign_id: string | null;
  item_type: AiInboxItemType;
  title: string;
  summary: string | null;
  urgency_score: number;
  ai_draft_response: string | null;
  ai_draft_confidence: number | null;
  expires_at: string | null;
  status: AiInboxItemStatus;
  snoozed_until: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboxFilters {
  status?: AiInboxItemStatus;
  item_type?: AiInboxItemType;
  limit?: number;
  offset?: number;
}

export interface InboxResponse {
  items: AiInboxItem[];
  total: number;
}

export const useInbox = (filters: InboxFilters = {}) => {
  return useQuery({
    queryKey: ['ai-inbox', filters],
    queryFn: async (): Promise<InboxResponse> => {
      const { data } = await api.get<{ data: AiInboxItem[]; meta: { total: number } }>('/ai-inbox', {
        params: filters,
      });
      return { items: data.data, total: data.meta?.total ?? data.data.length };
    },
  });
};

export interface ActionInboxInput {
  id: string;
  action: 'approve' | 'reject' | 'snooze';
  snoozed_until?: string;
}

export const useActionInboxItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, snoozed_until }: ActionInboxInput) => {
      const { data } = await api.patch<{ data: AiInboxItem }>(`/ai-inbox/${id}/action`, {
        action,
        snoozed_until,
      });
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
    },
  });
};
