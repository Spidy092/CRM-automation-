import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { CustomFieldDefinition, CustomFieldType } from '@/types';

export interface CustomFieldInput {
  label: string;
  field_key: string;
  field_type: CustomFieldType;
  options?: string[] | null;
  is_required?: boolean;
  is_active?: boolean;
}

export function useCustomFields() {
  return useQuery({
    queryKey: ['custom-fields'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CustomFieldDefinition[]>>('/custom-fields');
      return response.data.data ?? [];
    },
  });
}

export function useCreateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomFieldInput) => {
      const response = await apiClient.post<ApiResponse<CustomFieldDefinition>>('/custom-fields', input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}

export function useUpdateCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<CustomFieldInput> }) => {
      const response = await apiClient.put<ApiResponse<CustomFieldDefinition>>(`/custom-fields/${id}`, input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}
