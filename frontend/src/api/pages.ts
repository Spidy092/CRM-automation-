import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { ApiResponse } from './client';

export type PageStatus = 'draft' | 'published';

export type PageBlock =
  | { type: 'gallery'; fileIds: string[] }
  | { type: 'link'; label: string; url: string }
  | { type: 'attachment'; fileId: string; label?: string }
  | { type: 'video'; youtubeUrl: string }
  | { type: 'map'; address: string };

export interface LandingPage {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  blocks: PageBlock[];
  status: PageStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PublicFileRef {
  url: string;
  filename: string;
  mimeType: string;
}

export interface PublicLandingPage {
  title: string;
  slug: string;
  description: string | null;
  blocks: PageBlock[];
  /** Resolves every fileId referenced by a gallery/attachment block to its public URL. */
  files: Record<string, PublicFileRef>;
}

export interface LandingPageInput {
  title: string;
  slug: string;
  description?: string | null;
  blocks?: PageBlock[];
}

export interface PageView {
  id: string;
  page_id: string;
  lead_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  viewed_at: string;
}

export interface PageViewStats {
  total: number;
  recent: PageView[];
}

const PAGES_KEY = ['pages'];

export function usePages() {
  return useQuery({
    queryKey: PAGES_KEY,
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LandingPage[]>>('/pages/admin');
      return response.data.data;
    },
  });
}

export function usePage(id: string) {
  return useQuery({
    queryKey: [...PAGES_KEY, id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<LandingPage>>(`/pages/admin/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function usePageViews(id: string) {
  return useQuery({
    queryKey: [...PAGES_KEY, id, 'views'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PageViewStats>>(`/pages/admin/${id}/views`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function usePublicPage(slug: string, leadId?: string) {
  return useQuery({
    queryKey: [...PAGES_KEY, 'public', slug, leadId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PublicLandingPage>>(`/pages/${slug}`, {
        params: leadId ? { lead: leadId } : undefined,
      });
      return response.data.data;
    },
    enabled: !!slug,
    retry: false,
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LandingPageInput) => {
      const response = await apiClient.post<ApiResponse<LandingPage>>('/pages/admin', input);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAGES_KEY });
    },
  });
}

export function useUpdatePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: Partial<LandingPageInput> }) => {
      const response = await apiClient.put<ApiResponse<LandingPage>>(`/pages/admin/${id}`, input);
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: PAGES_KEY });
      queryClient.invalidateQueries({ queryKey: [...PAGES_KEY, id] });
    },
  });
}

export function usePublishPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<LandingPage>>(`/pages/admin/${id}/publish`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAGES_KEY });
    },
  });
}

export function useUnpublishPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<LandingPage>>(`/pages/admin/${id}/unpublish`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAGES_KEY });
    },
  });
}

export function useDeletePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/pages/admin/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PAGES_KEY });
    },
  });
}
