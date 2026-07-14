import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiResponse } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CampaignVariant {
  id: string;
  campaign_id: string;
  name: string;
  variant_key: string;
  template_id: string | null;
  split_pct: number;
  is_winner: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VariantMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export interface VariantResult {
  variant: CampaignVariant;
  metrics: VariantMetrics;
}

export interface ABTestConfig {
  enabled: boolean;
  metric: 'open_rate' | 'click_rate' | 'reply_rate';
  minSamples: number;
  confidence: number;
  autoPromote: boolean;
}

export interface ABTestReport {
  campaignId: string;
  config: ABTestConfig;
  variants: VariantResult[];
  winner: VariantResult | null;
  isSignificant: boolean;
  pValue: number | null;
  confidenceLevel: number;
  totalSent: number;
}

export interface CreateVariantInput {
  name: string;
  variantKey: string;
  templateId: string;
  splitPct: number;
}

export type UpdateVariantInput = Partial<CreateVariantInput>;

// ── Hooks ─────────────────────────────────────────────────────────────────

const AB_KEY = ['ab-testing'];

export function useVariants(campaignId: string) {
  return useQuery({
    queryKey: [...AB_KEY, 'variants', campaignId],
    queryFn: () => apiClient.get<ApiResponse<CampaignVariant[]>>(`/ab-testing/campaigns/${campaignId}/variants`).then((r) => r.data),
    enabled: !!campaignId,
  });
}

export function useVariant(id: string) {
  return useQuery({
    queryKey: [...AB_KEY, 'variant', id],
    queryFn: () => apiClient.get<ApiResponse<CampaignVariant>>(`/ab-testing/variants/${id}`).then((r) => r.data),
    enabled: !!id,
  });
}

export function useABTestReport(campaignId: string) {
  return useQuery({
    queryKey: [...AB_KEY, 'report', campaignId],
    queryFn: () => apiClient.get<ApiResponse<ABTestReport>>(`/ab-testing/campaigns/${campaignId}/report`).then((r) => r.data),
    enabled: !!campaignId,
  });
}

export function useVariantResults(variantId: string) {
  return useQuery({
    queryKey: [...AB_KEY, 'results', variantId],
    queryFn: () => apiClient.get<ApiResponse<VariantResult>>(`/ab-testing/variants/${variantId}/results`).then((r) => r.data),
    enabled: !!variantId,
  });
}

export function useCreateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ campaignId, data }: { campaignId: string; data: CreateVariantInput }) =>
      apiClient.post<ApiResponse<CampaignVariant>>(`/ab-testing/campaigns/${campaignId}/variants`, data).then((r) => r.data),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: [...AB_KEY, 'variants', variables.campaignId] });
      qc.invalidateQueries({ queryKey: [...AB_KEY, 'report', variables.campaignId] });
    },
  });
}

export function useUpdateVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, data }: { variantId: string; data: UpdateVariantInput }) =>
      apiClient.put<ApiResponse<CampaignVariant>>(`/ab-testing/variants/${variantId}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...AB_KEY] });
    },
  });
}

export function useDeleteVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => apiClient.delete(`/ab-testing/variants/${variantId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...AB_KEY] });
    },
  });
}

export function usePromoteWinner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      apiClient.post<ApiResponse<{ promoted: boolean; winner: CampaignVariant | null }>>(`/ab-testing/campaigns/${campaignId}/promote-winner`).then((r) => r.data),
    onSuccess: (_result, campaignId) => {
      qc.invalidateQueries({ queryKey: [...AB_KEY, 'variants', campaignId] });
      qc.invalidateQueries({ queryKey: [...AB_KEY, 'report', campaignId] });
    },
  });
}

export function useRecordSnapshots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      apiClient.post(`/ab-testing/campaigns/${campaignId}/snapshots`).then((r) => r.data),
    onSuccess: (_result, campaignId) => {
      qc.invalidateQueries({ queryKey: [...AB_KEY, 'report', campaignId] });
    },
  });
}
