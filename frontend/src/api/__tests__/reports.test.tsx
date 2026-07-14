import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardMetrics, useExportReport, useCampaignAnalytics, useIntegrationAnalytics } from '../reports';
import { apiClient } from '../client';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } })
  }
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('reports API', () => {
  it('renders useDashboardMetrics successfully', () => {
    const { result } = renderHook(() => useDashboardMetrics({} as any), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useExportReport successfully', () => {
    const { result } = renderHook(() => useExportReport(), { wrapper });
    expect(result.current).toBeDefined();
  });

  it('renders useCampaignAnalytics successfully', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            date: '2026-06-01',
            campaignId: 'c1',
            campaignName: 'Summer',
            channel: 'email',
            leadsTargeted: 100,
            leadsConverted: 10,
            conversionRate: 0.1
          }
        ]
      }
    });
    const { result } = renderHook(
      () => useCampaignAnalytics({ startDate: '2026-06-01', endDate: '2026-06-30' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0].campaignName).toBe('Summer');
  });

  it('renders useIntegrationAnalytics successfully', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        success: true,
        data: [
          {
            name: 'Salesforce',
            type: 'crm',
            totalCalls: 50,
            successfulCalls: 45,
            failedCalls: 5,
            avgResponseTimeMs: 120,
            lastCalledAt: '2026-06-30T00:00:00Z'
          }
        ]
      }
    });
    const { result } = renderHook(
      () => useIntegrationAnalytics({ limit: 10, offset: 0 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0].name).toBe('Salesforce');
  });
});
