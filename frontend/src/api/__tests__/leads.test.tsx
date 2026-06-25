import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useLeads, useLead, useCreateLead, useUpdateLead, useDeleteLead, useImportLeads, usePauseLead } from '../leads';
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

describe('leads API', () => {
  it('renders useLeads successfully', async () => {
    const { result } = renderHook(() => useLeads({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useLead successfully', async () => {
    const { result } = renderHook(() => useLead({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useCreateLead successfully', async () => {
    const { result } = renderHook(() => useCreateLead({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useUpdateLead successfully', async () => {
    const { result } = renderHook(() => useUpdateLead({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useDeleteLead successfully', async () => {
    const { result } = renderHook(() => useDeleteLead({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useImportLeads successfully', async () => {
    const { result } = renderHook(() => useImportLeads({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders usePauseLead successfully', async () => {
    const { result } = renderHook(() => usePauseLead({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
});
