import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  useCampaigns,
  useCampaign,
  useCampaignStats,
  useCampaignStepStats,
  useCampaignLeads,
  useCreateCampaign,
  useUpdateCampaign,
  useDeleteCampaign,
  useLaunchCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useAddLeadsToCampaign,
  useRetryLeadOutreachStep,
  useAutomationPreview,
} from '../campaigns';
import { apiClient } from '../client';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.post).mockReset();
  vi.mocked(apiClient.put).mockReset();
  vi.mocked(apiClient.delete).mockReset();
  queryClient.clear();
});

describe('campaigns API hooks', () => {
  // ── Queries ─────────────────────────────────────────────────────────────

  it('useCampaigns fetches from /campaigns', async () => {
    const campaigns = [{ id: 'c1', name: 'Test' }];
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: campaigns } });

    const { result } = renderHook(() => useCampaigns(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns', { params: undefined });
    expect(result.current.data).toEqual(campaigns);
  });

  it('useCampaigns passes pipeline_id param', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } });

    renderHook(() => useCampaigns({ pipeline_id: 'pipe-1' }), { wrapper });

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns', { params: { pipeline_id: 'pipe-1' } });
  });

  it('useCampaign fetches a single campaign by id', async () => {
    const campaign = { id: 'c1', name: 'Q3 Push' };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: campaign } });

    const { result } = renderHook(() => useCampaign('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/c1');
    expect(result.current.data).toEqual(campaign);
  });

  it('useCampaign does not fetch when id is empty', () => {
    const { result } = renderHook(() => useCampaign(''), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('useCampaignStats fetches stats', async () => {
    const stats = { total_leads: 10, sent: 8, delivered: 7, opened: 5, replied: 2, failed: 1 };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: stats } });

    const { result } = renderHook(() => useCampaignStats('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/c1/stats');
    expect(result.current.data).toEqual(stats);
  });

  it('useCampaignStepStats fetches step stats', async () => {
    const stepStats = [{ step_number: 1, sent: 5, delivered: 4, opened: 3, replied: 1, failed: 0 }];
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: stepStats } });

    const { result } = renderHook(() => useCampaignStepStats('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/c1/stats/steps');
    expect(result.current.data).toEqual(stepStats);
  });

  it('useCampaignStepStats defaults to empty array when data is null', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: null } });

    const { result } = renderHook(() => useCampaignStepStats('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('useCampaignLeads fetches enrolled leads', async () => {
    const leads = [{ lead_id: 'l1', business_name: 'Acme', lead_status: 'active' }];
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: leads } });

    const { result } = renderHook(() => useCampaignLeads('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/c1/leads');
    expect(result.current.data).toEqual(leads);
  });

  it('useAutomationPreview fetches preview when enabled', async () => {
    const preview = { eligibleLeads: [], skippedLeads: [], expectedJobs: 0 };
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: preview } });

    const { result } = renderHook(() => useAutomationPreview('c1', true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledWith('/campaigns/c1/automation-preview');
    expect(result.current.data).toEqual(preview);
  });

  it('useAutomationPreview does not fetch when disabled', () => {
    const { result } = renderHook(() => useAutomationPreview('c1', false), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  // ── Mutations ───────────────────────────────────────────────────────────

  it('useCreateCampaign POSTs to /campaigns', async () => {
    const created = { id: 'c1', name: 'New Campaign' };
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: created } });

    const { result } = renderHook(() => useCreateCampaign(), { wrapper });

    const res = await result.current.mutateAsync({ name: 'New Campaign', tone: 'formal' });

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns', { name: 'New Campaign', tone: 'formal' });
    expect(res).toEqual(created);
  });

  it('useUpdateCampaign PUTs to /campaigns/:id', async () => {
    const updated = { id: 'c1', name: 'Updated' };
    vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true, data: updated } });

    const { result } = renderHook(() => useUpdateCampaign(), { wrapper });

    const res = await result.current.mutateAsync({ id: 'c1', input: { name: 'Updated' } });

    expect(apiClient.put).toHaveBeenCalledWith('/campaigns/c1', { name: 'Updated' });
    expect(res).toEqual(updated);
  });

  it('useDeleteCampaign DELETEs /campaigns/:id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() => useDeleteCampaign(), { wrapper });

    await result.current.mutateAsync('c1');

    expect(apiClient.delete).toHaveBeenCalledWith('/campaigns/c1');
  });

  it('useLaunchCampaign POSTs to /campaigns/:id/launch', async () => {
    const campaign = { id: 'c1', status: 'active' };
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: campaign, meta: { automation: { enqueued: 5, skipped: 1, mockMode: false } } },
    });

    const { result } = renderHook(() => useLaunchCampaign(), { wrapper });

    const res = await result.current.mutateAsync('c1');

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/launch');
    expect(res.campaign).toEqual(campaign);
    expect(res.automation).toEqual({ enqueued: 5, skipped: 1, mockMode: false });
  });

  it('usePauseCampaign POSTs to /campaigns/:id/pause', async () => {
    const campaign = { id: 'c1', status: 'paused' };
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: campaign } });

    const { result } = renderHook(() => usePauseCampaign(), { wrapper });

    const res = await result.current.mutateAsync('c1');

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/pause');
    expect(res).toEqual(campaign);
  });

  it('useResumeCampaign POSTs to /campaigns/:id/resume', async () => {
    const campaign = { id: 'c1', status: 'active' };
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: campaign } });

    const { result } = renderHook(() => useResumeCampaign(), { wrapper });

    const res = await result.current.mutateAsync('c1');

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/resume');
    expect(res).toEqual(campaign);
  });

  it('useAddLeadsToCampaign POSTs lead_ids to /campaigns/:id/leads', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { added: 3 } } });

    const { result } = renderHook(() => useAddLeadsToCampaign(), { wrapper });

    const res = await result.current.mutateAsync({ campaignId: 'c1', leadIds: ['l1', 'l2', 'l3'] });

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/leads', { lead_ids: ['l1', 'l2', 'l3'] });
    expect(res).toEqual({ added: 3 });
  });

  it('useRetryLeadOutreachStep POSTs to /campaigns/:id/leads/:leadId/retry', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { enqueued: true } } });

    const { result } = renderHook(() => useRetryLeadOutreachStep(), { wrapper });

    const res = await result.current.mutateAsync({ campaignId: 'c1', leadId: 'l1' });

    expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/leads/l1/retry');
    expect(res).toEqual({ enqueued: true });
  });
});
