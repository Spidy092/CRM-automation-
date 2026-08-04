import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { Lead, Pipeline, PipelineStage } from '@/types';

export type { Pipeline, PipelineStage };

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
      const response = await apiClient.get<ApiResponse<PipelineWithStages[]>>('/pipelines');
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
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
    onMutate: async ({ leadId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });

      const previousLeadsQueries = queryClient.getQueriesData({ queryKey: ['leads'] });

      queryClient.setQueriesData<any>({ queryKey: ['leads'] }, (oldData) => {
        if (!oldData) return oldData;
        if (Array.isArray(oldData.items)) {
          return {
            ...oldData,
            items: oldData.items.map((lead: Lead) =>
              lead.id === leadId ? { ...lead, pipeline_stage_id: stageId } : lead,
            ),
          };
        }
        return oldData;
      });

      return { previousLeadsQueries };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLeadsQueries) {
        context.previousLeadsQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export interface BulkMoveResult {
  succeeded: string[];
  failed: Array<{ leadId: string; error: string }>;
}

export function useBulkMoveLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadIds, stageId }: { leadIds: string[]; stageId: string }): Promise<BulkMoveResult> => {
      const results = await Promise.allSettled(
        leadIds.map(async (leadId) => {
          await apiClient.post<ApiResponse<{ message: string }>>('/pipelines/move-lead', {
            lead_id: leadId,
            stage_id: stageId,
          });
          return leadId;
        })
      );

      const succeeded: string[] = [];
      const failed: Array<{ leadId: string; error: string }> = [];

      results.forEach((res, index) => {
        const leadId = leadIds[index];
        if (res.status === 'fulfilled') {
          succeeded.push(leadId);
        } else {
          const reason = res.reason;
          const msg = reason?.response?.data?.error || reason?.message || 'Failed to move lead';
          failed.push({ leadId, error: msg });
        }
      });

      if (failed.length > 0 && succeeded.length === 0) {
        throw new Error(failed[0].error || 'Failed to move selected leads');
      }

      return { succeeded, failed };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useCreateStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipelineId,
      input,
    }: {
      pipelineId: string;
      input: { name: string; position: number; is_terminal_won?: boolean; is_terminal_lost?: boolean };
    }) => {
      const response = await apiClient.post<ApiResponse<PipelineStage>>(
        `/pipelines/${pipelineId}/stages`,
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useUpdateStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: { name?: string; position?: number; is_terminal_won?: boolean; is_terminal_lost?: boolean };
    }) => {
      const response = await apiClient.put<ApiResponse<PipelineStage>>(
        `/pipelines/stages/${id}`,
        input,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}

export function useDeleteStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/pipelines/stages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
    },
  });
}
