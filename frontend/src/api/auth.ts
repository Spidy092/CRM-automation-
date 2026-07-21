import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { LoginInput, LoginResult, User } from '@/types';

export function useLogin() {
  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const response = await apiClient.post<ApiResponse<LoginResult>>('/auth/login', input);
      return response.data.data;
    },
  });
}

export function useRefreshToken() {
  return useMutation({
    mutationFn: async (refreshToken: string) => {
      const response = await apiClient.post<ApiResponse<{ accessToken: string }>>('/auth/refresh', {
        refreshToken,
      });
      return response.data.data;
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async (refreshToken: string) => {
      await apiClient.post('/auth/logout', { refreshToken });
    },
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<User>>('/auth/me');
      return response.data.data;
    },
    retry: false,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const response = await apiClient.post<ApiResponse<{ message: string }>>('/auth/forgot-password', {
        email,
      });
      return response.data.data;
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ token, password }: { token: string; password: string }) => {
      const response = await apiClient.post<ApiResponse<{ message: string }>>('/auth/reset-password', {
        token,
        newPassword: password,
      });
      return response.data.data;
    },
  });
}

// -----------------------------------------------------------------------------
// API Keys
// -----------------------------------------------------------------------------
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export function useApiKeys() {
  return useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ApiKey[]>>('/auth/api-keys');
      return response.data.data;
    },
  });
}

export function useCreateApiKey() {
  return useMutation({
    mutationFn: async (data: { name: string; expiresInDays?: number }) => {
      const response = await apiClient.post<ApiResponse<{ rawKey: string; apiKey: ApiKey }>>(
        '/auth/api-keys',
        data,
      );
      return response.data.data;
    },
  });
}

export function useDeleteApiKey() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.delete<ApiResponse<{ message: string }>>(`/auth/api-keys/${id}`);
      return response.data.data;
    },
  });
}
