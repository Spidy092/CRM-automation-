import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiResponse } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'checkbox' | 'hidden';
  required: boolean;
  placeholder?: string;
  options?: string[];
  defaultValue?: string;
  leadField?: string;
}

export interface PublicForm {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  submitMessage: string;
  theme: Record<string, unknown>;
}

export interface Form {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fields: FormField[];
  submit_action: string;
  submit_message: string;
  redirect_url: string | null;
  is_active: boolean;
  theme: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  lead_id: string | null;
  data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
  status: string;
  created_at: string;
}

export interface FormAnalytics {
  formId: string;
  formName: string;
  totalSubmissions: number;
  uniqueLeads: number;
  conversionRate: number;
  submissionsByDay: { date: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
}

export interface CreateFormInput {
  name: string;
  slug?: string;
  description?: string | null;
  fields: FormField[];
  submit_action?: string;
  submit_message?: string;
  redirect_url?: string | null;
  is_active?: boolean;
  theme?: Record<string, unknown>;
}

export type UpdateFormInput = Partial<CreateFormInput>;

// ── Hooks ─────────────────────────────────────────────────────────────────

const FORMS_KEY = ['forms'];

export function useListForms(limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...FORMS_KEY, { limit, offset }],
    queryFn: () => apiClient.get<ApiResponse<Form[]>>('/forms/admin', { params: { limit, offset } }).then((r) => r.data),
  });
}

export function useForm(id: string) {
  return useQuery({
    queryKey: [...FORMS_KEY, id],
    queryFn: () => apiClient.get<ApiResponse<Form>>(`/forms/admin/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useFormBySlug(slug: string) {
  return useQuery({
    queryKey: [...FORMS_KEY, 'slug', slug],
    queryFn: () => apiClient.get<ApiResponse<PublicForm>>(`/forms/${slug}`).then((r) => r.data),
    enabled: !!slug,
  });
}

export function useFormAnalytics(formId: string) {
  return useQuery({
    queryKey: [...FORMS_KEY, formId, 'analytics'],
    queryFn: () => apiClient.get<ApiResponse<FormAnalytics>>(`/forms/admin/${formId}/analytics`).then((r) => r.data),
    enabled: !!formId,
  });
}

export function useFormEmbed(formId: string) {
  return useQuery({
    queryKey: [...FORMS_KEY, formId, 'embed'],
    queryFn: () => apiClient.get<ApiResponse<{ snippet: string; formId: string; slug: string }>>(`/forms/admin/${formId}/embed`).then((r) => r.data),
    enabled: !!formId,
  });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFormInput) => apiClient.post<ApiResponse<Form>>('/forms/admin', data).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFormInput }) =>
      apiClient.put<ApiResponse<Form>>(`/forms/admin/${id}`, data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: FORMS_KEY });
      qc.invalidateQueries({ queryKey: [...FORMS_KEY, variables.id] });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/forms/admin/${id}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: FORMS_KEY }); },
  });
}

export function useSubmitForm() {
  return useMutation({
    mutationFn: ({ formId, data }: { formId: string; data: Record<string, unknown> }) =>
      apiClient.post<ApiResponse<{ message: string; leadId?: string; redirectUrl?: string }>>(
        `/forms/${formId}/submit`,
        data,
      ).then((r) => r.data),
  });
}
