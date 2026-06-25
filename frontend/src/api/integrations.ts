import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface Integration {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  last_tested_at: string | null;
  last_test_status: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface UpdateIntegrationInput {
  is_enabled?: boolean;
  credentials?: Record<string, unknown> | null;
}

export interface TestIntegrationResult {
  ok: boolean;
  status: string;
  message: string;
  tested_at: string;
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Integration[]>>('/integrations');
      return response.data.data ?? [];
    },
  });
}

export function useIntegration(id: string) {
  return useQuery({
    queryKey: ['integrations', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Integration>>(`/integrations/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useUpdateIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateIntegrationInput }) => {
      const response = await apiClient.patch<ApiResponse<Integration>>(
        `/integrations/${id}`,
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useTestIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<TestIntegrationResult>>(
        `/integrations/${id}/test`,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}
