import { useQuery } from '@tanstack/react-query';
import { apiClient as api } from './client';
import type { AiDecisionLogEntry, DecisionType } from './aiIntelligence';

export type { AiDecisionLogEntry, DecisionType };

export interface DecisionLogFilters {
  decision_type?: DecisionType;
  limit?: number;
  offset?: number;
}

export interface DecisionLogResponse {
  items: AiDecisionLogEntry[];
  total: number;
}

export interface DecisionLogQueryOptions {
  enabled?: boolean;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
}

export const useDecisionLog = (
  filters: DecisionLogFilters = {},
  options: DecisionLogQueryOptions = {},
) => {
  return useQuery({
    queryKey: ['ai-decisions', filters],
    queryFn: async (): Promise<DecisionLogResponse> => {
      const { data } = await api.get<{ data: AiDecisionLogEntry[]; meta: { total: number } }>(
        '/ai-intelligence/decisions',
        { params: filters },
      );
      return { items: data.data, total: data.meta?.total ?? data.data.length };
    },
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
  });
};
