import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { MessageChannel } from '@/types';

export interface MessageSnippet {
  id: string;
  title: string;
  channel: MessageChannel | null;
  body: string;
  variables: string[];
  file_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MessageSnippetInput {
  title: string;
  channel?: MessageChannel | null;
  body: string;
  variables?: string[];
  file_ids?: string[];
}

export function useMessageSnippets(filters: { channel?: MessageChannel; search?: string } = {}) {
  return useQuery({
    queryKey: ['messages', filters],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<MessageSnippet[]>>('/messages', {
        params: filters,
      });
      return response.data.data;
    },
  });
}

export function useMessageSnippet(id: string) {
  return useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<MessageSnippet>>(`/messages/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateMessageSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MessageSnippetInput) => {
      const response = await apiClient.post<ApiResponse<MessageSnippet>>('/messages', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function useUpdateMessageSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<MessageSnippetInput> }) => {
      const response = await apiClient.put<ApiResponse<MessageSnippet>>(`/messages/${id}`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function useDeleteMessageSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/messages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}
