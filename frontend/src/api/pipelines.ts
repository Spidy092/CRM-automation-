import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
}

export interface CreatePipelineInput {
  name: string;
  is_default?: boolean;
  stages: Array<{
    name: string;
    position: number;
    is_terminal_won?: boolean;
    is_terminal_lost?: boolean;
  }>;
}

export interface UpdatePipelineInput {
  name?: string;
  is_default?: boolean;
}

export function usePipelines() {
  return useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Pipeline[]>>('/pipelines');
      return response.data.data;
    },
  });
}

export function usePipeline(id: string) {
  return useQuery({
    queryKey: ['pipelines', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PipelineWithStages>>(`/pipelines/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreatePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePipelineInput) => {
      const response = await apiClient.post<ApiResponse<PipelineWithStages>>('/pipelines', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdatePipelineInput }) => {
      const response = await apiClient.put<ApiResponse<Pipeline>>(`/pipelines/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines', id] });
    },
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/pipelines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useMoveLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, stageId }: { leadId: string; stageId: string }) => {
      const response = await apiClient.post<ApiResponse<{ message: string }>>('/pipelines/move-lead', {
        lead_id: leadId,
        stage_id: stageId,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}
