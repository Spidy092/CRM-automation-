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
  exclude_tags?: string;
  search?: string;
  limit?: number;
  cursor?: string;
  /** ISO-8601 datetime — only return leads created at or after this point */
  created_after?: string;
  /** When true, only return leads where classification is null */
  unclassified?: boolean;
  /** Offset paging — alternative to `cursor`, used by the customizable leads table */
  offset?: number;
  /** Whitelisted sort column (see backend `listLeadsQuerySchema`) */
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  /** Ask the server for the total row count so page numbers can be rendered */
  count_total?: boolean;
}

interface LeadsPageResult {
  items: Lead[];
  meta: { limit: number; hasMore: boolean; nextCursor?: string; total?: number };
}

function buildLeadParams(filters: LeadFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.classification) params.append('classification', filters.classification);
  if (filters.source_platform) params.append('source_platform', filters.source_platform);
  if (filters.assigned_to) params.append('assigned_to', filters.assigned_to);
  if (filters.pipeline_id) params.append('pipeline_id', filters.pipeline_id);
  if (filters.tags) params.append('tags', filters.tags);
  if (filters.exclude_tags) params.append('exclude_tags', filters.exclude_tags);
  if (filters.search) params.append('search', filters.search);
  if (filters.limit) params.append('limit', filters.limit.toString());
  if (filters.created_after) params.append('created_after', filters.created_after);
  if (filters.unclassified) params.append('unclassified', 'true');
  if (filters.offset !== undefined) params.append('offset', filters.offset.toString());
  if (filters.sort_by) params.append('sort_by', filters.sort_by);
  if (filters.sort_dir) params.append('sort_dir', filters.sort_dir);
  if (filters.count_total) params.append('count_total', 'true');
  const actualCursor = cursor || filters.cursor;
  if (actualCursor) params.append('cursor', actualCursor);
  return params;
}

export interface LeadsTablePage {
  items: Lead[];
  meta: { limit: number; hasMore: boolean; total?: number; offset?: number };
}

/**
 * Offset-paginated, sortable leads for the customizable leads table. Keeps the
 * previous page on screen while the next one loads so the table doesn't flash.
 */
export function useLeadsTable(
  filters: Omit<LeadFilters, 'cursor'> & { limit: number; offset: number },
) {
  return useQuery({
    queryKey: ['leads', 'table', filters],
    queryFn: async (): Promise<LeadsTablePage> => {
      const params = buildLeadParams({ ...filters, count_total: true });
      const response = await apiClient.get<ApiResponse<Lead[]>>('/leads', { params });
      const meta = response.data.meta as LeadsTablePage['meta'] | undefined;
      return {
        items: response.data.data ?? [],
        meta: meta ?? { limit: filters.limit, hasMore: false },
      };
    },
    placeholderData: (previous) => previous,
  });
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
      const params = buildLeadParams(filters, filters.cursor);

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
    queryFn: async (): Promise<ActivitiesPageResult> => {
      const params = new URLSearchParams();
      if (filters.type) params.append('type', filters.type);
      if (filters.limit !== undefined) params.append('limit', filters.limit.toString());
      if (filters.offset !== undefined) params.append('offset', filters.offset.toString());
      const response = await apiClient.get<ApiResponse<ActivityWithUser[]>>(
        `/leads/${leadId}/activities`,
        { params },
      );
      const items = response.data.data ?? [];
      const meta = response.data.meta as ActivitiesPageResult['meta'] | undefined;
      return { items, meta: meta ?? { total: items.length, limit: filters.limit ?? items.length, offset: filters.offset ?? 0 } };
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
      queryClient.invalidateQueries({ queryKey: ['leads', leadId, 'history'] });
    },
  });
}

// ── Unified lead history (notes + messages + system events) ────────────────

export type LeadHistoryKind = 'all' | 'notes' | 'messages' | 'system';

export type LeadHistoryChannel = 'call' | 'whatsapp' | 'email' | 'sms' | 'phone_call';

export interface LeadHistoryEntry {
  id: string;
  source: 'activity' | 'message';
  activity_type: ActivityType | null;
  channel: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  message_body: string | null;
  step_number: number | null;
  error_message: string | null;
  author_id: string | null;
  author_name: string | null;
  is_pinned: boolean;
  created_at: string;
}

export interface LeadHistoryFilters {
  kind?: LeadHistoryKind;
  search?: string;
  channel?: LeadHistoryChannel;
  author?: string;
  /** `yyyy-mm-dd` from a date input; converted to an ISO bound client-side. */
  dateFrom?: string;
  dateTo?: string;
}

interface LeadHistoryPage {
  items: LeadHistoryEntry[];
  meta: { limit: number; hasMore: boolean; nextCursor?: string };
}

/** Calendar filters use the same local timezone as the displayed timestamps. */
function toDateBound(date: string, endOfDay: boolean): string {
  const bound = new Date(`${date}T00:00:00`);
  if (endOfDay) bound.setHours(23, 59, 59, 999);
  return bound.toISOString();
}

function buildHistoryParams(filters: LeadHistoryFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  params.append('limit', '25');
  if (filters.kind) params.append('kind', filters.kind);
  if (filters.search) params.append('search', filters.search);
  if (filters.channel) params.append('channel', filters.channel);
  if (filters.author) params.append('author', filters.author);
  if (filters.dateFrom) params.append('date_from', toDateBound(filters.dateFrom, false));
  if (filters.dateTo) params.append('date_to', toDateBound(filters.dateTo, true));
  if (cursor) params.append('cursor', cursor);
  return params;
}

/**
 * Cursor-paginated unified history for the lead detail timeline. Pages are
 * fetched 25 at a time newest-first; flatten `data.pages` and dedupe by id
 * for the combined list. Search/channel/author/date filters run server-side
 * across the full history, not just the loaded pages.
 */
export function useLeadHistory(leadId: string, filters: LeadHistoryFilters = {}) {
  return useInfiniteQuery({
    queryKey: ['leads', leadId, 'history', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<LeadHistoryPage> => {
      const params = buildHistoryParams(filters, pageParam);
      const response = await apiClient.get<ApiResponse<LeadHistoryEntry[]>>(
        `/leads/${leadId}/timeline`,
        { params },
      );
      const meta = response.data.meta as LeadHistoryPage['meta'] | undefined;
      return {
        items: response.data.data ?? [],
        meta: meta ?? { limit: 25, hasMore: false },
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
    enabled: !!leadId,
  });
}

/** Pinned notes rendered in the strip above the history. */
export function usePinnedNotes(leadId: string) {
  return useInfiniteQuery({
    queryKey: ['leads', leadId, 'history', 'pinned'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<LeadHistoryPage> => {
      const params = buildHistoryParams({ kind: 'notes' }, pageParam);
      params.append('pinned_only', 'true');
      const response = await apiClient.get<ApiResponse<LeadHistoryEntry[]>>(
        `/leads/${leadId}/timeline`, { params },
      );
      return { items: response.data.data ?? [], meta: response.data.meta as LeadHistoryPage['meta'] };
    },
    getNextPageParam: (page) => page.meta.hasMore ? page.meta.nextCursor : undefined,
    enabled: !!leadId,
  });
}

export function useLeadHistoryAuthors(leadId: string) {
  return useQuery({
    queryKey: ['leads', leadId, 'history', 'authors'],
    queryFn: async (): Promise<Array<{ id: string; name: string | null }>> => {
      const response = await apiClient.get<ApiResponse<Array<{ id: string; name: string | null }>>>(
        `/leads/${leadId}/activities/authors`,
      );
      return response.data.data ?? [];
    },
    enabled: !!leadId,
  });
}

export function useSetActivityPinned() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leadId,
      activityId,
      pinned,
    }: {
      leadId: string;
      activityId: string;
      pinned: boolean;
    }) => {
      const response = await apiClient.patch<ApiResponse<LeadHistoryEntry>>(
        `/leads/${leadId}/activities/${activityId}/pin`,
        { pinned },
      );
      return response.data.data;
    },
    onSuccess: (_, { leadId }) => {
      queryClient.invalidateQueries({ queryKey: ['leads', leadId, 'history'] });
    },
  });
}

export function useBulkUpdateLeads() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, patch, tag_mode }: {
      ids: string[]; patch: Partial<import('@/types').LeadInput>; tag_mode?: 'append';
    }) => {
      const response = await apiClient.post<ApiResponse<{ updated: number }>>(
        '/leads/bulk-update',
        { ids, patch, ...(tag_mode ? { tag_mode } : {}) },
      );
      return response.data.data;
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
      const response = await apiClient.post<ApiResponse<{ updated: number; cancelledJobs?: number }>>(
        '/leads/bulk-pause',
        { ids, paused },
      );
      return response.data.data;
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
