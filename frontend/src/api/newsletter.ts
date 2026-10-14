import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export type NewsletterSubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type NewsletterFrequency = 'daily' | 'weekly' | 'monthly';
export type NewsletterTopic = 'product_updates' | 'promotions' | 'company_news';

export interface NewsletterSubscriber {
  id: string;
  email: string;
  status: NewsletterSubscriberStatus;
  topics: string[];
  frequency: NewsletterFrequency;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubscribeInput {
  email: string;
  topics?: string[];
  frequency?: NewsletterFrequency;
}

export interface UpdatePreferencesInput {
  topics?: string[];
  frequency?: NewsletterFrequency;
}

export interface ListSubscribersParams {
  limit?: number;
  offset?: number;
  status?: NewsletterSubscriberStatus;
  search?: string;
  topic?: NewsletterTopic;
  source?: string;
  frequency?: NewsletterFrequency;
}

export interface SubscriberCounts {
  pending: number;
  confirmed: number;
  unsubscribed: number;
  total: number;
}

export function useSubscribers(params?: ListSubscribersParams) {
  return useQuery({
    queryKey: ['newsletter-subscribers', params],
    queryFn: async () => {
      const { limit = 50, offset = 0, status, search, topic, source, frequency } = params || {};
      const queryParams = new URLSearchParams();
      queryParams.append('limit', limit.toString());
      queryParams.append('offset', offset.toString());
      if (status) queryParams.append('status', status);
      if (search) queryParams.append('search', search);
      if (topic) queryParams.append('topic', topic);
      if (source) queryParams.append('source', source);
      if (frequency) queryParams.append('frequency', frequency);
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber[]>>(
        `/newsletter/admin/subscribers?${queryParams.toString()}`
      );
      return {
        data: response.data.data,
        meta: response.data.meta as { limit: number; offset: number; total: number } | undefined,
      };
    },
  });
}

/** Audience-wide summary counts, independent of current list filters/page. */
export function useSubscriberCounts() {
  return useQuery({
    queryKey: ['newsletter-subscribers', 'counts'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SubscriberCounts>>(
        '/newsletter/admin/subscribers/counts'
      );
      return response.data.data;
    },
  });
}

export function useSubscriber(id: string) {
  return useQuery({
    queryKey: ['newsletter-subscribers', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber>>(`/newsletter/admin/subscribers/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useEligibleCount(targeting?: { topics?: string[]; frequency?: NewsletterFrequency }) {
  return useQuery({
    queryKey: ['newsletter-eligible-count', targeting],
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const t of targeting?.topics ?? []) params.append('topics', t);
      if (targeting?.frequency) params.append('frequency', targeting.frequency);
      const qs = params.toString();
      const response = await apiClient.get<ApiResponse<{ eligible: number }>>(
        `/newsletter/admin/eligible-count${qs ? `?${qs}` : ''}`
      );
      return response.data.data;
    },
  });
}

// ── Public Routes ────────────────────────────────────────────────────────

export function useSubscribe() {
  return useMutation({
    mutationFn: async (input: SubscribeInput) => {
      const response = await apiClient.post<ApiResponse<NewsletterSubscriber>>('/newsletter/subscribe', input);
      return response.data.data;
    },
  });
}

export function useConfirmSubscription() {
  return useMutation({
    mutationFn: async (token: string) => {
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber>>(`/newsletter/confirm?token=${token}`);
      return response.data.data;
    },
  });
}

export function useUnsubscribe() {
  return useMutation({
    mutationFn: async (token: string) => {
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber>>(`/newsletter/unsubscribe?token=${token}`);
      return response.data.data;
    },
  });
}

export function useNewsletterPreferences(token: string) {
  return useQuery({
    queryKey: ['newsletter-preferences', token],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber>>(`/newsletter/preferences?token=${token}`);
      return response.data.data;
    },
    enabled: !!token,
  });
}

export function useUpdateNewsletterPreferences() {
  return useMutation({
    mutationFn: async ({ token, input }: { token: string; input: UpdatePreferencesInput }) => {
      const response = await apiClient.patch<ApiResponse<NewsletterSubscriber>>(`/newsletter/preferences?token=${token}`, input);
      return response.data.data;
    },
  });
}

// ── Admin Routes ─────────────────────────────────────────────────────────

export interface BroadcastInput {
  subject: string;
  htmlBody: string;
  previewText?: string;
  topics?: NewsletterTopic[];
  frequency?: NewsletterFrequency;
  scheduledAt?: string;
  /** Wall-clock time; converted server-side using `timezone`. */
  scheduledAtLocal?: string;
  timezone?: string;
  idempotencyKey?: string;
  templateId?: string;
}

export interface BroadcastResult {
  enqueued: boolean;
  scheduledAt?: string;
  scheduledAtLocal?: string;
  ambiguous?: boolean;
  eligible?: number;
}

export function useBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BroadcastInput) => {
      const response = await apiClient.post<ApiResponse<BroadcastResult>>('/newsletter/admin/broadcast', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-subscribers'] });
    },
  });
}

export function useTestSendNewsletter() {
  return useMutation({
    mutationFn: async (input: { to: string; subject: string; htmlBody: string; previewText?: string }) => {
      const response = await apiClient.post<ApiResponse<{ sent: boolean; channel: string }>>(
        '/newsletter/admin/test-send',
        input
      );
      return response.data.data;
    },
  });
}

export interface AutomatedDigestToggleInput {
  enabled: boolean;
}

export function useToggleAutomatedDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutomatedDigestToggleInput) => {
      const response = await apiClient.post<ApiResponse<{ enabled: boolean }>>('/newsletter/admin/automated-digest', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-status'] });
    },
  });
}

export interface DigestStatus {
  enabled: boolean;
  schedule: string;
  timezone: string;
  nextRunAt: string | null;
  autoSend: boolean;
  lastOutcome: { status: 'success' | 'failed' | 'needs_review' | 'never_run'; message: string; at: string | null };
}

/** Persisted digest status — refresh-safe (backend Redis + repeatable-job source of truth). */
export function useDigestStatus() {
  return useQuery({
    queryKey: ['newsletter-digest-status'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<DigestStatus>>('/newsletter/admin/digest-status');
      return response.data.data;
    },
  });
}

export interface NewsletterDigestConfig {
  topic: string;
  tone: 'professional' | 'casual' | 'motivational' | 'technical';
  customPrompt: string;
  targetAudience: string;
}

export function useDigestConfig() {
  return useQuery({
    queryKey: ['newsletter-digest-config'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<NewsletterDigestConfig>>('/newsletter/admin/digest-config');
      return response.data.data;
    },
  });
}

export function useUpdateDigestConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NewsletterDigestConfig) => {
      const response = await apiClient.put<ApiResponse<NewsletterDigestConfig>>('/newsletter/admin/digest-config', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-config'] });
    },
  });
}

export interface DigestDraft {
  subject: string;
  htmlBody: string;
  status: 'draft' | 'approved' | 'sent';
  createdAt: string;
  updatedAt: string;
  note?: string;
}

export function useDigestDraft() {
  return useQuery({
    queryKey: ['newsletter-digest-draft'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<{ draft: DigestDraft | null; autoSend: boolean }>>(
        '/newsletter/admin/digest-draft'
      );
      return response.data.data;
    },
  });
}

export function useSaveDigestDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { subject: string; htmlBody: string }) => {
      const response = await apiClient.post<ApiResponse<DigestDraft>>('/newsletter/admin/digest-draft', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-draft'] });
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-status'] });
    },
  });
}

export function useApproveDigestDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<BroadcastResult>>('/newsletter/admin/digest-draft/approve');
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-draft'] });
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-status'] });
    },
  });
}

export function useSetDigestAutoSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { autoSend: boolean }) => {
      const response = await apiClient.post<ApiResponse<{ autoSend: boolean }>>(
        '/newsletter/admin/digest-auto-send',
        input
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-draft'] });
      queryClient.invalidateQueries({ queryKey: ['newsletter-digest-status'] });
    },
  });
}

export interface BroadcastHistoryItem {
  id: string;
  subject: string;
  status: 'completed' | 'partially_failed' | 'failed' | 'processing' | 'scheduled' | 'draft';
  topics: string[];
  frequency: string | null;
  /** Frequency list for automated sends (digest targets daily + weekly). */
  frequencies?: string[];
  timezone: string;
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  /** Sends with UNKNOWN outcome — never auto-resent, operator review only. */
  uncertain: number;
  uncertainIds: string[];
  failureCount: number;
  finishedAt: string;
  delivered: null;
  bounced: null;
  clicked: null;
  unsubscribed: null;
}

export function useBroadcasts() {
  return useQuery({
    queryKey: ['newsletter-broadcasts'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BroadcastHistoryItem[]>>(
        '/newsletter/admin/broadcasts'
      );
      return response.data.data;
    },
  });
}

export interface RetryBroadcastResult {
  enqueued: boolean;
  broadcastId?: string;
  retrying?: number;
  retryingUncertain?: number;
  recovered?: boolean;
}

export function useRetryBroadcast() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, includeUncertain }: { id: string; includeUncertain?: boolean }) => {
      const response = await apiClient.post<ApiResponse<RetryBroadcastResult>>(
        `/newsletter/admin/broadcasts/${id}/retry-failed`,
        { includeUncertain: includeUncertain ?? false }
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsletter-broadcasts'] });
    },
  });
}

export interface UncertainRecipient {
  subscriberId: string;
  email: string | null;
}

export function useUncertainRecipients(broadcastId: string | null) {
  return useQuery({
    queryKey: ['newsletter-broadcasts', broadcastId, 'uncertain'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<UncertainRecipient[]>>(
        `/newsletter/admin/broadcasts/${broadcastId}/uncertain-recipients`
      );
      return response.data.data;
    },
    enabled: !!broadcastId,
  });
}
