import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from './client';
import type {
  DashboardMetrics,
  LeadGenerationRow,
  OutreachPerformanceRow,
  PipelineConversionRow,
  SalesRepPerformanceRow,
  ReportListFilters,
  ExportJobInput,
  ExportJobResult,
} from '@/types';

/* ─── Dashboard ─── */

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<DashboardMetrics>>('/reports/dashboard');
      return response.data.data;
    },
    refetchInterval: 60_000,
  });
}

/* ─── Lead Generation Report ─── */

export function useLeadGenerationReport(filters: ReportListFilters = {}) {
  return useQuery({
    queryKey: ['reports', 'leads', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.offset) params.append('offset', filters.offset.toString());
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);

      const response = await apiClient.get<ApiResponse<LeadGenerationRow[]>>('/reports/leads', { params });
      const meta = response.data.meta as { limit: number; hasMore: boolean } | undefined;
      return { items: response.data.data, meta: meta ?? { limit: 50, hasMore: false } } as PaginatedResponse<LeadGenerationRow>;
    },
  });
}

/* ─── Outreach Performance Report ─── */

export function useOutreachReport(filters: ReportListFilters = {}) {
  return useQuery({
    queryKey: ['reports', 'outreach', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.offset) params.append('offset', filters.offset.toString());
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);

      const response = await apiClient.get<ApiResponse<OutreachPerformanceRow[]>>('/reports/outreach', { params });
      const meta = response.data.meta as { limit: number; hasMore: boolean } | undefined;
      return { items: response.data.data, meta: meta ?? { limit: 50, hasMore: false } } as PaginatedResponse<OutreachPerformanceRow>;
    },
  });
}

/* ─── Pipeline Report ─── */

export function usePipelineReport(filters: ReportListFilters = {}) {
  return useQuery({
    queryKey: ['reports', 'pipeline', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.offset) params.append('offset', filters.offset.toString());
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);

      const response = await apiClient.get<ApiResponse<PipelineConversionRow[]>>('/reports/pipeline', { params });
      const meta = response.data.meta as { limit: number; hasMore: boolean } | undefined;
      return { items: response.data.data, meta: meta ?? { limit: 50, hasMore: false } } as PaginatedResponse<PipelineConversionRow>;
    },
  });
}

/* ─── Sales Rep Performance Report ─── */

export function useSalesRepReport(filters: ReportListFilters = {}) {
  return useQuery({
    queryKey: ['reports', 'reps', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.offset) params.append('offset', filters.offset.toString());
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);

      const response = await apiClient.get<ApiResponse<SalesRepPerformanceRow[]>>('/reports/reps', { params });
      const meta = response.data.meta as { limit: number; hasMore: boolean } | undefined;
      return { items: response.data.data, meta: meta ?? { limit: 50, hasMore: false } } as PaginatedResponse<SalesRepPerformanceRow>;
    },
  });
}

/* ─── Export Job ─── */

export function useExportReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ExportJobInput) => {
      const response = await apiClient.post<ApiResponse<ExportJobResult>>('/reports/export', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
