import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export interface LibraryFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateFileInput {
  filename?: string;
  tags?: string[];
}

export function useFiles(filters: { tag?: string; search?: string } = {}) {
  return useQuery({
    queryKey: ['files', filters],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LibraryFile[]>>('/files', {
        params: filters,
      });
      return response.data.data;
    },
  });
}

export function useFile(id: string) {
  return useQuery({
    queryKey: ['files', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LibraryFile>>(`/files/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useUploadFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await apiClient.post<ApiResponse<LibraryFile>>('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useUpdateFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateFileInput }) => {
      const response = await apiClient.patch<ApiResponse<LibraryFile>>(`/files/${id}`, input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}

export function useDeleteFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/files/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
}
