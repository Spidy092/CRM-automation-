import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse, PaginatedResponse } from './client';
import type { Activity, ActivityType, ActivityWithUser, Lead, LeadInput, ImportSummary } from '@/types';

interface LeadFilters {
  status?: string;
  classification?: string;
  source_platform?: string;
  assigned_to?: string;
  pipeline_id?: string;
  tags?: string;
  search?: string;
  limit?: number;
  cursor?: string;
  /** ISO-8601 datetime — only return leads created at or after this point */
  created_after?: string;
  /** When true, only return leads where classification is null */
  unclassified?: boolean;
}

interface LeadsPageResult {
  items: Lead[];
  meta: { limit: number; hasMore: boolean; nextCursor?: string };
}

function buildLeadParams(filters: LeadFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.classification) params.append('classification', filters.classification);
  if (filters.source_platform) params.append('source_platform', filters.source_platform);
  if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
  if (filters.pipeline_id) params.append('pipeline_id', filters.pipeline_id);
  if (filters.tags) params.append('tags', filters.tags);
  if (filters.search) params.append('search', filters.search);
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.created_after) params.append('created_after', filters.created_after);
  if (filters.unclassified) params.append('unclassified', 'true');
  if (cursor) params.append('cursor', cursor);
  return params;
}

/**
 * Cursor-paginated leads with "load more" support. Use on the leads list so the
 * full set is reachable (the dashboard total counts every lead, while a single
 * page only returns `limit` rows). Flatten `data.pages` for the combined list.
 */
export function useInfiniteLeads(filters: Omit<LeadFilters, 'cursor'> = {}) {
  return useInfiniteQuery({
    queryKey: ['leads', 'infinite', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const params = buildLeadParams(filters, pageParam);
      const response = await apiClient.get<ApiResponse<Lead[]>>('/leads', { params });
      const meta = response.data.meta as LeadsPageResult['meta'] | undefined;
      return {
        items: response.data.data,
        meta: meta ?? { limit: 25, hasMore: false },
      } as LeadsPageResult;
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
  });
}

export function useLeads(filters: LeadFilters = {}) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.classification) params.append('classification', filters.classification);
      if (filters.source_platform) params.append('source_platform', filters.source_platform);
      if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
      if (filters.pipeline_id) params.append('pipeline_id', filters.pipeline_id);
      if (filters.search) params.append('search', filters.search);
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.cursor) params.append('cursor', filters.cursor);

      const response = await apiClient.get<ApiResponse<Lead[]>>('/leads', { params });
      const meta = response.data.meta as { limit: number; hasMore: boolean; nextCursor?: string } | undefined;
      return {
        items: response.data.data,
        meta: meta ?? { limit: 25, hasMore: false },
      } as PaginatedResponse<Lead>;
    },
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ['leads', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Lead>>(`/leads/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LeadInput) => {
      const response = await apiClient.post<ApiResponse<Lead>>('/leads', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useUpdateLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LeadInput> }) => {
      const response = await apiClient.put<ApiResponse<Lead>>(`/leads/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export function useDeleteLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useImportLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, source }: { file: File; source: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('source', source);

      const response = await apiClient.post<ApiResponse<ImportSummary>>('/leads/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function usePauseLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const response = await apiClient.post<ApiResponse<Lead>>(`/leads/${id}/pause`, { paused });
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export interface LeadActivityEntry {
  id: string;
  kind: 'audit' | 'outreach';
  action: string | null;
  channel: string | null;
  status: string | null;
  actor_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export function useLeadActivity(leadId: string, limit = 50) {
  return useQuery({
    queryKey: ['leads', leadId, 'activity', limit],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LeadActivityEntry[]>>(
        `/leads/${leadId}/activity`,
        { params: { limit } },
      );
      return response.data.data ?? [];
    },
    enabled: !!leadId,
  });
}

interface ActivityFilters {
  type?: ActivityType;
  limit?: number;
  offset?: number;
}

interface ActivitiesPageResult {
  items: ActivityWithUser[];
  meta: { total: number; limit: number; offset: number };
}

export function useLeadActivities(leadId: string, filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: ['leads', leadId, 'activities', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.type) params.append('type', filters.type);
      if (filters.limit !== undefined) params.append('limit', filters.limit.toString());
      if (filters.offset !== undefined) params.append('offset', filters.offset.toString());
      const response = await apiClient.get<ApiResponse<ActivitiesPageResult>>(
        `/leads/${leadId}/activities`,
        { params },
      );
      return response.data.data;
    },
    enabled: !!leadId,
  });
}

export interface CreateActivityInput {
  type: Exclude<ActivityType, 'status_change' | 'assignment_change'>;
  metadata?: Record<string, unknown>;
}

export function useCreateLeadActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ leadId, input }: { leadId: string; input: CreateActivityInput }) => {
      const response = await apiClient.post<ApiResponse<Activity>>(`/leads/${leadId}/activities`, input);
      return response.data.data;
    },
    onSuccess: (_, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: ['leads', leadId, 'activities'] });
    },
  });
}

export function useBulkUpdateLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: Partial<import('@/types').LeadInput> }) => {
      await Promise.all(
        ids.map((id) => apiClient.put<ApiResponse<Lead>>(`/leads/${id}`, patch)),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useBulkPauseLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, paused }: { ids: string[]; paused: boolean }) => {
      await Promise.all(
        ids.map((id) => apiClient.post<ApiResponse<Lead>>(`/leads/${id}/pause`, { paused })),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useEnrichLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Lead>>(`/leads/${id}/enrich`);
      return response.data.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', id] });
    },
  });
}

export function useBulkClassifyLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ids,
      classification,
    }: {
      ids: string[];
      classification: 'hot' | 'warm' | 'cold';
    }) => {
      const response = await apiClient.post<ApiResponse<{ updated: number }>>(
        '/leads/bulk-classify',
        { ids, classification },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
