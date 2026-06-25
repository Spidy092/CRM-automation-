import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export interface AiSettings {
  id: string;
  enabled: boolean;
  base_url: string | null;
  has_api_key: boolean;
  model: string;
  max_tokens: number;
  temperature: number;
  system_prompt_override: string | null;
  cache_ttl_seconds: number;
  updated_by: string | null;
  updated_at: string;
}

export interface UpdateAiSettingsInput {
  enabled?: boolean;
  base_url?: string | null;
  api_key?: string | null;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system_prompt_override?: string | null;
  cache_ttl_seconds?: number;
}

export const useAiSettings = () => {
  return useQuery({
    queryKey: ['ai-settings'],
    queryFn: async () => {
      const { data } = await api.get<{ data: AiSettings }>('/ai-settings');
      return data.data;
    },
  });
};

export const useUpdateAiSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAiSettingsInput) => {
      const { data } = await api.patch<{ data: AiSettings }>('/ai-settings', input);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] });
    },
  });
};
