import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type {
  DiscoveredPage,
  ScraperConfig,
  ScraperLog,
  ScraperRunLeadsResult,
  ScraperRunResult,
  ScraperSourceType,
  ScraperStatsSummary,
} from '@/types';

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
      webhook_url?: string | null;
      group_name?: string | null;
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
      webhook_url?: string | null;
      group_name?: string | null;
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
      // Refresh logs, the source list (last_run_at), and leads/dashboard
      // since a successful run imports new leads.
      queryClient.invalidateQueries({ queryKey: ['scraper', 'logs'] });
      queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['scraper', 'stats-summary'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/* ─── AI Auto-detect Selectors ─── */

export function useDetectSelectors() {
  return useMutation({
    mutationFn: async (url: string) => {
      const response = await apiClient.post<
        ApiResponse<{ containerSelector: string; selectors: Record<string, string> }>
      >('/scraper/detect-selectors', { url });
      return response.data.data;
    },
  });
}

/* ─── Discover Pages (crawl nav links so the user can pick which to add) ─── */

export function useDiscoverPages() {
  return useMutation({
    mutationFn: async (url: string) => {
      const response = await apiClient.post<ApiResponse<DiscoveredPage[]>>(
        '/scraper/discover-pages',
        { url },
      );
      return response.data.data;
    },
  });
}

/* ─── Scraper Logs ─── */

export function useScraperLogs(configId: string, limit = 25) {
  const queryClient = useQueryClient();
  // Tracks whether the previous poll saw a run in flight, so the moment it
  // reaches a terminal state we can refresh everything a finished run changes.
  const wasRunningRef = useRef(false);

  return useQuery({
    // `limit` is part of the key: without it, changing the page size would
    // silently read another size's cached result.
    queryKey: ['scraper', 'logs', configId, limit],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperLog[]>>(`/scraper/${configId}/logs`, {
        params: { limit },
      });
      const logs = response.data.data;

      // "Run Now" returns 202 before the scrape happens, so the invalidations
      // it fires all run against pre-run state. This poll is the only thing
      // that observes the run actually finishing — so it is also the only
      // place that can refresh last_run_at, source health, the 24h stat cards
      // and the lead list. Without this they stay stale until a page reload.
      const isRunning = logs[0]?.status === 'running';
      if (wasRunningRef.current && !isRunning) {
        void queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
        void queryClient.invalidateQueries({ queryKey: ['scraper', 'stats-summary'] });
        void queryClient.invalidateQueries({ queryKey: ['leads'] });
        void queryClient.invalidateQueries({ queryKey: ['reports'] });
      }
      wasRunningRef.current = isRunning;

      return logs;
    },
    enabled: !!configId,
    // Poll while the most recent run is still in progress so the status
    // updates without the user needing to reopen the logs panel.
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest?.status === 'running' ? 3000 : false;
    },
  });
}

/* ─── 24h (or custom window) Dashboard Summary ─── */

export function useScraperStatsSummary(hours = 24) {
  return useQuery({
    queryKey: ['scraper', 'stats-summary', hours],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperStatsSummary>>('/scraper/stats/summary', {
        params: { hours },
      });
      return response.data.data;
    },
  });
}

/* ─── Leads created by a specific run ─── */

export function useScraperRunLeads(logId: string) {
  return useQuery({
    queryKey: ['scraper', 'run-leads', logId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperRunLeadsResult>>(
        `/scraper/logs/${logId}/leads`,
      );
      return response.data.data;
    },
    enabled: !!logId,
  });
}

/* ─── Retry Failed Records ─── */

export function useRetryFailedScrape() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (logId: string) => {
      const response = await apiClient.post<ApiResponse<ScraperRunResult>>(
        `/scraper/logs/${logId}/retry-failed`,
      );
      return response.data.data;
    },
    onSuccess: (_data, logId) => {
      queryClient.invalidateQueries({ queryKey: ['scraper', 'logs'] });
      queryClient.invalidateQueries({ queryKey: ['scraper', 'configs'] });
      queryClient.invalidateQueries({ queryKey: ['scraper', 'run-leads', logId] });
      queryClient.invalidateQueries({ queryKey: ['scraper', 'stats-summary'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

/* ─── Export Run Leads as CSV ─── */

export async function exportRunLeadsCsv(logId: string): Promise<void> {
  const response = await apiClient.get(`/scraper/logs/${logId}/export`, {
    responseType: 'blob',
  });
  const disposition = response.headers?.['content-disposition'] ?? '';
  const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
  const filename = filenameMatch?.[1] ?? `scraper-run-${logId.slice(0, 8)}.csv`;
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/* ─── List Distinct Group Names ─── */

export function useScraperGroups() {
  return useQuery({
    queryKey: ['scraper', 'groups'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<string[]>>('/scraper/groups');
      return response.data.data;
    },
  });
}

/* ─── Scraper Trends (time-series) ─── */

export interface ScraperTrendPoint {
  date: string;
  runs: number;
  leads_imported: number;
  leads_found: number;
  leads_failed: number;
  success_rate: number;
}

export function useScraperTrends(days = 14) {
  return useQuery({
    queryKey: ['scraper', 'trends', days],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ScraperTrendPoint[]>>('/scraper/trends', {
        params: { days },
      });
      return response.data.data;
    },
  });
}
