import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { ScraperConfig, ScraperLog, ScraperRunResult, ScraperSourceType } from '@/types';

/* ─── List Configs ─── */

export function useScraperConfigs() {
  return useQuery({
    queryKey: ['scraper', 'configs'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperConfig[]>>('/scraper');
      return response.data.data;
    },
  });
}

/* ─── Single Config ─── */

export function useScraperConfig(id: string) {
  return useQuery({
    queryKey: ['scraper', 'configs', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperConfig>>(`/scraper/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

/* ─── Create Config ─── */

export function useCreateScraperConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      source_type: ScraperSourceType;
      config: Record<string, unknown>;
      is_active?: boolean;
      schedule_cron?: string | null;
    }) => {
      const response = await apiClient.post<ApiResponse<ScraperConfig>>('/scraper', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
    },
  });
}

/* ─── Update Config ─── */

export function useUpdateScraperConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id: string;
      name?: string;
      is_active?: boolean;
      config?: Record<string, unknown>;
      schedule_cron?: string | null;
    }) => {
      const response = await apiClient.put<ApiResponse<ScraperConfig>>(`/scraper/${id}`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
    },
  });
}

/* ─── Delete Config ─── */

export function useDeleteScraperConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/scraper/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
    },
  });
}

/* ─── Trigger Scrape ─── */

export function useTriggerScrape() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (configId: string) => {
      const response = await apiClient.post<ApiResponse<ScraperRunResult>>(`/scraper/${configId}/scrape`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraper', 'logs'] });
    },
  });
}

/* ─── Scraper Logs ─── */

export function useScraperLogs(configId: string, limit = 25) {
  return useQuery({
    queryKey: ['scraper', 'logs', configId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperLog[]>>(`/scraper/${configId}/logs`, {
        params: { limit },
      });
      return response.data.data;
    },
    enabled: !!configId,
  });
}
