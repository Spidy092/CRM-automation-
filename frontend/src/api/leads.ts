import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from './client';
import type { Lead, LeadInput, ImportSummary } from '@/types';

interface LeadFilters {
  status?: string;
  classification?: string;
  source_platform?: string;
  assigned_to?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export function useLeads(filters: LeadFilters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.classification) params.append('classification', filters.classification);
      if (filters.source_platform) params.append('source_platform', filters.source_platform);
      if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
      if (filters.search) params.append('search', filters.search);
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.cursor) params.append('cursor', filters.cursor);

      const response = await apiClient.get<PaginatedResponse<Lead>>('/leads', { params });
      return response.data;
    },
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Lead>>(`/leads/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LeadInput) => {
      const response = await apiClient.post<ApiResponse<Lead>>('/leads', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LeadInput> }) => {
      const response = await apiClient.put<ApiResponse<Lead>>(`/leads/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, source }: { file: File; source: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source', source);

      const response = await apiClient.post<ApiResponse<ImportSummary>>('/leads/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function usePauseLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const response = await apiClient.post<ApiResponse<Lead>>(`/leads/${id}/pause`, { paused });
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}
