import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export type NewsletterSubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type NewsletterFrequency = 'daily' | 'weekly' | 'monthly';

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
}

export function useSubscribers(params?: ListSubscribersParams) {
  return useQuery({
    queryKey: ['newsletter-subscribers', params],
    queryFn: async () => {
      const { limit = 50, offset = 0, status } = params || {};
      const queryParams = new URLSearchParams();
      queryParams.append('limit', limit.toString());
      queryParams.append('offset', offset.toString());
      if (status) {
        queryParams.append('status', status);
      }
      const response = await apiClient.get<ApiResponse<NewsletterSubscriber[]>>(
        `/newsletter/admin/subscribers?${queryParams.toString()}`
      );
      return {
        data: response.data.data,
        meta: response.data.meta,
      };
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
}

export function useBroadcast() {
  return useMutation({
    mutationFn: async (input: BroadcastInput) => {
      const response = await apiClient.post<ApiResponse<{ enqueued: boolean }>>('/newsletter/admin/broadcast', input);
      return response.data.data;
    },
  });
}

export interface AutomatedDigestToggleInput {
  enabled: boolean;
}

export function useToggleAutomatedDigest() {
  return useMutation({
    mutationFn: async (input: AutomatedDigestToggleInput) => {
      const response = await apiClient.post<ApiResponse<{ enabled: boolean }>>('/newsletter/admin/automated-digest', input);
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
  return useMutation({
    mutationFn: async (input: NewsletterDigestConfig) => {
      const response = await apiClient.put<ApiResponse<NewsletterDigestConfig>>('/newsletter/admin/digest-config', input);
      return response.data.data;
    },
  });
}

