import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  useIntegrations,
  useIntegration,
  useUpdateIntegration,
  useTestIntegration,
  useBulkTestIntegration,
  bulkTestIntegrations,
} from '../integrations';

const mockPost = vi.fn();
const mockGet = vi.fn();
const mockPatch = vi.fn();

vi.mock('../client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('integrations API', () => {
  beforeEach(() => {
    queryClient.clear();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it('useIntegrations fetches integrations', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [{ id: '1', name: 'twilio' }] },
    });
    const { result } = renderHook(() => useIntegrations(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: '1', name: 'twilio' }]);
  });

  it('useIntegration fetches a single integration', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: { id: '1', name: 'twilio' } },
    });
    const { result } = renderHook(() => useIntegration('1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: '1', name: 'twilio' });
  });

  it('useUpdateIntegration patches and invalidates integrations', async () => {
    mockPatch.mockResolvedValueOnce({
      data: { data: { id: '1', name: 'twilio', is_enabled: true } },
    });
    const { result } = renderHook(() => useUpdateIntegration(), { wrapper });
    await result.current.mutateAsync({ id: '1', input: { is_enabled: true } });
    expect(mockPatch).toHaveBeenCalledWith('/integrations/1', { is_enabled: true });
  });

  it('useTestIntegration posts a test and invalidates integrations', async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { ok: true, status: 'passed', message: 'ok', tested_at: 'now' } },
    });
    const { result } = renderHook(() => useTestIntegration(), { wrapper });
    await result.current.mutateAsync('1');
    expect(mockPost).toHaveBeenCalledWith('/integrations/1/test');
  });

  it('useBulkTestIntegration calls bulkTestIntegrations and invalidates integrations', async () => {
    const bulkResult = {
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      results: [],
    };
    mockPost.mockResolvedValueOnce({ data: { data: bulkResult } });
    const { result } = renderHook(() => useBulkTestIntegration(), { wrapper });
    await result.current.mutateAsync();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/integrations/test-all');
    expect(result.current.data).toEqual(bulkResult);
  });

  it('bulkTestIntegrations can be invoked directly', async () => {
    const bulkResult = {
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      results: [],
    };
    mockPost.mockResolvedValueOnce({ data: { data: bulkResult } });
    const result = await bulkTestIntegrations();
    expect(mockPost).toHaveBeenCalledWith('/integrations/test-all');
    expect(result).toEqual(bulkResult);
  });
});
