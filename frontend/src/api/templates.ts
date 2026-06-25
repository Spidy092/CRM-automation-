import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { Template, MessageChannel, TemplateApprovalStatus } from '@/types';

export interface TemplateInput {
  name: string;
  channel: MessageChannel;
  subject?: string | null;
  body: string;
  variables?: string[];
}

interface TemplateFilters {
  channel?: MessageChannel;
  approval_status?: TemplateApprovalStatus;
  search?: string;
  limit?: number;
}

export function useTemplates(filters: TemplateFilters = {}) {
  return useQuery({
    queryKey: ['templates', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(filters.limit ?? 100));
      if (filters.channel) params.set('channel', filters.channel);
      if (filters.approval_status) params.set('approval_status', filters.approval_status);
      if (filters.search) params.set('search', filters.search);
      const response = await apiClient.get<ApiResponse<Template[]>>(`/templates?${params.toString()}`);
      return response.data.data ?? [];
    },
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Template>>(`/templates/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateInput) => {
      const response = await apiClient.post<ApiResponse<Template>>('/templates', input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<TemplateInput> }) => {
      const response = await apiClient.put<ApiResponse<Template>>(`/templates/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}

export function useApproveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approved, rejection_reason }: { id: string; approved: boolean; rejection_reason?: string }) => {
      const response = await apiClient.post<ApiResponse<Template>>(`/templates/${id}/approve`, { approved, rejection_reason });
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/templates/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}
