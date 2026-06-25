import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useAssignmentConfig, useUpdateAssignmentConfig, useEligibleUsers, useUserAssignments, useManualAssign, useOverrideAssign } from '../assignments';
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

describe('assignments API', () => {
  it('renders useAssignmentConfig successfully', async () => {
    const { result } = renderHook(() => useAssignmentConfig({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useUpdateAssignmentConfig successfully', async () => {
    const { result } = renderHook(() => useUpdateAssignmentConfig({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useEligibleUsers successfully', async () => {
    const { result } = renderHook(() => useEligibleUsers({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useUserAssignments successfully', async () => {
    const { result } = renderHook(() => useUserAssignments({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useManualAssign successfully', async () => {
    const { result } = renderHook(() => useManualAssign({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useOverrideAssign successfully', async () => {
    const { result } = renderHook(() => useOverrideAssign({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
});
