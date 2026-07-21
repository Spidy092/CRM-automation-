import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { User, UserRole } from '@/types';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  is_active?: boolean;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<User[]>>('/users');
      return response.data.data;
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const response = await apiClient.post<ApiResponse<User>>('/users', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export interface UpdateUserPermissionsInput {
  id: string;
  role?: UserRole;
  is_active?: boolean;
}

export function useUpdateUserPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateUserPermissionsInput) => {
      const response = await apiClient.patch<ApiResponse<User>>(`/users/${id}/permissions`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
