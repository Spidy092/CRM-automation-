import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface ScoringConfig {
  id: string;
  hot_min_score: number;
  warm_min_score: number;
  assignment_threshold: number;
  updated_at: string;
}

export interface ScoringRule {
  id: string;
  factor: string;
  weight: number;
  condition: Record<string, unknown>;
  score_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateScoringRuleInput {
  factor: string;
  weight: number;
  condition: Record<string, unknown>;
  score_value: number;
  is_active?: boolean;
}

export interface UpdateScoringRuleInput {
  factor?: string;
  weight?: number;
  condition?: Record<string, unknown>;
  score_value?: number;
  is_active?: boolean;
}

export interface UpdateScoringConfigInput {
  hot_min_score?: number;
  warm_min_score?: number;
  assignment_threshold?: number;
}

// Config Hooks
export function useScoringConfig() {
  return useQuery({
    queryKey: ['scoring-config'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScoringConfig>>('/scoring/config');
      return response.data.data;
    },
  });
}

export function useUpdateScoringConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateScoringConfigInput) => {
      const response = await apiClient.put<ApiResponse<ScoringConfig>>('/scoring/config', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-config'] });
    },
  });
}

// Rules Hooks
export function useScoringRules() {
  return useQuery({
    queryKey: ['scoring-rules'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScoringRule[]>>('/scoring/rules');
      return response.data.data;
    },
  });
}

export function useScoringRule(id: string) {
  return useQuery({
    queryKey: ['scoring-rules', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScoringRule>>(`/scoring/rules/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateScoringRuleInput) => {
      const response = await apiClient.post<ApiResponse<ScoringRule>>('/scoring/rules', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
    },
  });
}

export function useUpdateScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateScoringRuleInput }) => {
      const response = await apiClient.put<ApiResponse<ScoringRule>>(`/scoring/rules/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
      queryClient.invalidateQueries({ queryKey: ['scoring-rules', id] });
    },
  });
}

export function useDeleteScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/scoring/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scoring-rules'] });
    },
  });
}

// Calculate Hooks
export function useCalculateScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (leadId: string) => {
      const response = await apiClient.post<ApiResponse<{ leadId: string; score: number }>>(`/scoring/calculate/${leadId}`, {});
      return response.data.data;
    },
    onSuccess: (_, leadId) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', leadId] });
    },
  });
}

export function useRecalculateAllScores() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<{ processed: number }>>('/scoring/recalculate-all', {});
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
