import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export interface PlanPreviewStep {
  id: string;
  step_index: number;
  action_name: string;
  action_args: Record<string, unknown>;
  risk_tier: string;
  depends_on: number[];
  rationale: string;
  status: string;
}

export interface PlanPreview {
  plan: {
    id: string;
    goal: string;
    status: string;
    autonomy_level: string | null;
    confidence: number | null;
    created_at: string;
  };
  steps: PlanPreviewStep[];
  estimatedCostCents: number;
  requiresApproval: boolean;
}

export interface PlanRunResult {
  planId: string;
  status: string;
  errorMessage?: string;
}

export const usePlan = (planId: string) => {
  return useQuery({
    queryKey: ['agent-plan', planId],
    queryFn: async (): Promise<PlanPreview> => {
      const { data } = await api.get<{ data: PlanPreview }>(`/chat/plans/${planId}`);
      return data.data;
    },
    enabled: Boolean(planId),
    refetchInterval: (query) => {
      const status = query.state.data?.plan.status;
      return status === 'running' || status === 'paused_for_approval' ? 3000 : false;
    },
  });
};

export const useApprovePlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string): Promise<PlanRunResult> => {
      const { data } = await api.post<{ data: PlanRunResult }>(`/chat/plans/${planId}/approve`, {});
      return data.data;
    },
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plan', planId] });
      queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
    },
  });
};

export const useCancelPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string): Promise<void> => {
      await api.post(`/chat/plans/${planId}/cancel`, {});
    },
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-plan', planId] });
    },
  });
};
