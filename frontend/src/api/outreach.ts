import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from './client';

// ── Sequence types ─────────────────────────────────────────────────────────

export interface SequenceStep {
  stepNumber: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  delayHours: number;
  templateId: string | null;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  steps: SequenceStep[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateSequenceInput {
  name: string;
  description?: string | null;
  is_active?: boolean;
  steps: SequenceStep[];
}

export interface SequenceEnrollmentStats {
  currently_in: number;
  completed: number;
  removed: number;
}

// ── Outreach log types ─────────────────────────────────────────────────────

export interface OutreachTask {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  step_number: number | null;
  assigned_to: string | null;
  type: 'phone_call' | 'follow_up' | 'meeting_prep' | 'other';
  title: string;
  description: string | null;
  due_at: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManualSendInput {
  leadId: string;
  campaignId: string;
  sequenceId: string;
  stepNumber: number;
  channel: SequenceStep['channel'];
  templateId: string;
  mockMode?: boolean;
}

export interface OutreachLog {
  id: string;
  lead_id: string;
  campaign_id: string | null;
  channel: string;
  template_id: string | null;
  step_number: number | null;
  status: string;
  external_msg_id: string | null;
  message_body: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ── Timeline types ─────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  type: 'outreach_log' | 'task' | 'pipeline_change' | 'note';
  channel?: string;
  status?: string;
  title?: string;
  description?: string;
  occurred_at: string;
  meta?: Record<string, unknown>;
}

// ── Sequence hooks ─────────────────────────────────────────────────────────

export function useSequences() {
  return useQuery({
    queryKey: ['sequences'],
    queryFn: async () => {
      const response =
        await apiClient.get<ApiResponse<Sequence[]>>('/outreach/sequences');
      return {
        items: response.data.data,
        meta: response.data.meta as PaginatedResponse<Sequence>['meta'] ?? { limit: 25, hasMore: false },
      } as PaginatedResponse<Sequence>;
    },
  });
}

export function useSequence(id: string) {
  return useQuery({
    queryKey: ['sequences', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Sequence>>(`/outreach/sequences/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useSequenceStats(id: string) {
  return useQuery({
    queryKey: ['sequences', id, 'stats'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SequenceEnrollmentStats>>(
        `/outreach/sequences/${id}/stats`,
      );
      return response.data.data;
    },
    enabled: !!id,
    // Refresh every 60s so counts stay reasonably live
    refetchInterval: 60_000,
  });
}

export function useCreateSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSequenceInput) => {
      const response = await apiClient.post<ApiResponse<Sequence>>('/outreach/sequences', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
    },
  });
}

export function useUpdateSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<CreateSequenceInput> }) => {
      const response = await apiClient.put<ApiResponse<Sequence>>(
        `/outreach/sequences/${id}`,
        input,
      );
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
      queryClient.invalidateQueries({ queryKey: ['sequences', id] });
    },
  });
}

export function useDeleteSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/outreach/sequences/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequences'] });
    },
  });
}

// ── Lead outreach data hooks ───────────────────────────────────────────────

export function useLeadTimeline(leadId: string) {
  return useQuery({
    queryKey: ['leads', leadId, 'timeline'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TimelineEntry[]>>(
        `/outreach/leads/${leadId}/timeline`,
      );
      return response.data.data ?? [];
    },
    enabled: !!leadId,
  });
}

export function useLeadOutreachLogs(leadId: string) {
  return useQuery({
    queryKey: ['leads', leadId, 'logs'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<OutreachLog[]>>(
        `/outreach/leads/${leadId}/logs`,
      );
      return response.data.data ?? [];
    },
    enabled: !!leadId,
  });
}


export function useOutreachTasks(filters: { status?: OutreachTask['status']; assignedTo?: 'me' } = {}) {
  return useQuery({
    queryKey: ['outreach', 'tasks', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
      const response = await apiClient.get<ApiResponse<OutreachTask[]>>(
        `/outreach/tasks?${params.toString()}`,
      );
      return response.data.data ?? [];
    },
  });
}

export function useManualOutreachSend() {
  return useMutation({
    mutationFn: async (input: ManualSendInput) => {
      const response = await apiClient.post<ApiResponse<{ enqueued: boolean }>>('/outreach/send', input);
      return response.data.data;
    },
  });
}

// ── Quick response (ad-hoc single-lead send) ───────────────────────────────

export interface QuickSendInput {
  leadId: string;
  channel: SequenceStep['channel'];
  templateId: string;
}

export function useQuickSend() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, ...input }: QuickSendInput) => {
      const response = await apiClient.post<ApiResponse<OutreachLog>>(
        `/outreach/leads/${leadId}/quick-send`,
        input,
      );
      return response.data.data;
    },
    onSuccess: (_, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: ['leads', leadId, 'timeline'] });
      queryClient.invalidateQueries({ queryKey: ['leads', leadId, 'logs'] });
    },
  });
}
