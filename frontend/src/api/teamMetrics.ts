import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { MemberMetrics } from '@/types';

export function useTeamMetrics(from?: string, to?: string, stage?: string) {
  return useQuery({
    queryKey: ['team', 'metrics', { from, to, stage }],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<MemberMetrics[]>>('/team/metrics', {
        params: { from, to, stage },
      });
      return response.data.data;
    },
    staleTime: 60_000,
  });
}
