import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';
import type { Template, MessageChannel, TemplateApprovalStatus, TemplateEditorMode } from '@/types';

export interface TemplateInput {
  name: string;
  channel: MessageChannel;
  subject?: string | null;
  body: string;
  variables?: string[];
  editor_mode?: TemplateEditorMode;
  design?: unknown | null;
  preheader?: string | null;
}

interface TemplateFilters {
  channel?: MessageChannel;
  approval_status?: TemplateApprovalStatus;
  search?: string;
  limit?: number;
  cursor?: string;
  include_archived?: boolean;
  archived_only?: boolean;
  mine?: boolean;
}

export interface TemplatePreview {
  subject: string | null;
  html: string | null;
  text: string;
  variables: string[];
  invalidVariables: string[];
  unsafeLinks: string[];
  compliance: { errors: string[]; warnings: string[] };
  smsEstimate: { encoding: string; characters: number; segments: number; remainingInSegment: number } | null;
  whatsapp: { ok: boolean; errors: string[]; warnings: string[] } | null;
  notice: string;
}

export interface TestSendResult {
  sent: boolean;
  to: string;
  channel: string;
  externalId?: string;
  latencyMs: number;
  warnings: string[];
}

interface TemplateListResponse {
  items: Template[];
  meta: { nextCursor?: string; hasMore: boolean };
}

export function useTemplates(filters: TemplateFilters = {}) {
  return useQuery({
    queryKey: ['templates', filters],
    queryFn: async (): Promise<TemplateListResponse> => {
      const params = new URLSearchParams();
      params.set('limit', String(filters.limit ?? 20));
      if (filters.channel) params.set('channel', filters.channel);
      if (filters.approval_status) params.set('approval_status', filters.approval_status);
      if (filters.search) params.set('search', filters.search);
      if (filters.cursor) params.set('cursor', filters.cursor);
      if (filters.include_archived) params.set('include_archived', 'true');
      if (filters.archived_only) params.set('archived_only', 'true');
      if (filters.mine) params.set('mine', 'true');
      const response = await apiClient.get<ApiResponse<Template[]>>(`/templates?${params.toString()}`);
      return {
        items: response.data.data ?? [],
        meta: (response.data.meta as { nextCursor?: string; hasMore: boolean }) ?? { hasMore: false },
      };
    },
  });
}

export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<Template>>(`/templates/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateInput) => {
      const response = await apiClient.post<ApiResponse<Template>>('/templates', input);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<TemplateInput> }) => {
      const response = await apiClient.put<ApiResponse<Template>>(`/templates/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}

export function useApproveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, approved, rejection_reason }: { id: string; approved: boolean; rejection_reason?: string }) => {
      const response = await apiClient.post<ApiResponse<Template>>(`/templates/${id}/approve`, { approved, rejection_reason });
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/templates/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDuplicateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name?: string }) => {
      const response = await apiClient.post<ApiResponse<Template>>(`/templates/${id}/duplicate`, { name });
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useArchiveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Template>>(`/templates/${id}/archive`);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUnarchiveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<Template>>(`/templates/${id}/unarchive`);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useRenameTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const response = await apiClient.patch<ApiResponse<Template>>(`/templates/${id}/rename`, { name });
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: async ({ id, sample_values }: { id: string; sample_values?: Record<string, string> }) => {
      const response = await apiClient.post<ApiResponse<TemplatePreview>>(
        `/templates/${id}/preview`,
        { sample_values },
      );
      return response.data.data;
    },
  });
}

export function useTestSendTemplate() {
  return useMutation({
    mutationFn: async ({ id, to, sample_values }: { id: string; to: string; sample_values?: Record<string, string> }) => {
      const response = await apiClient.post<ApiResponse<TestSendResult>>(
        `/templates/${id}/test-send`,
        { to, sample_values },
      );
      return response.data.data;
    },
  });
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

export function useUploadTemplateAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        throw new Error('File is larger than 10MB.');
      }
      if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
        throw new Error('Unsupported file type. Allowed: PNG, JPEG, WEBP, GIF, PDF.');
      }
      const formData = new FormData();
      formData.append('file', file);
      const response = await apiClient.post<ApiResponse<Template>>(
        `/templates/${id}/attachments`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}

export function useAttachTemplateFromLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, fileId }: { id: string; fileId: string }) => {
      const response = await apiClient.post<ApiResponse<Template>>(
        `/templates/${id}/attachments/from-library`,
        { file_id: fileId },
      );
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}

export function useDeleteTemplateAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, attachmentId }: { id: string; attachmentId: string }) => {
      const response = await apiClient.delete<ApiResponse<Template>>(
        `/templates/${id}/attachments/${attachmentId}`,
      );
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['templates', id] });
    },
  });
}
