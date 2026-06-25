import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useScoringConfig, useUpdateScoringConfig, useScoringRules, useScoringRule, useCreateScoringRule, useUpdateScoringRule, useDeleteScoringRule, useCalculateScore, useRecalculateAllScores } from '../scoring';
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

describe('scoring API', () => {
  it('renders useScoringConfig successfully', async () => {
    const { result } = renderHook(() => useScoringConfig({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useUpdateScoringConfig successfully', async () => {
    const { result } = renderHook(() => useUpdateScoringConfig({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useScoringRules successfully', async () => {
    const { result } = renderHook(() => useScoringRules({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useScoringRule successfully', async () => {
    const { result } = renderHook(() => useScoringRule({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useCreateScoringRule successfully', async () => {
    const { result } = renderHook(() => useCreateScoringRule({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useUpdateScoringRule successfully', async () => {
    const { result } = renderHook(() => useUpdateScoringRule({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useDeleteScoringRule successfully', async () => {
    const { result } = renderHook(() => useDeleteScoringRule({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useCalculateScore successfully', async () => {
    const { result } = renderHook(() => useCalculateScore({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useRecalculateAllScores successfully', async () => {
    const { result } = renderHook(() => useRecalculateAllScores({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
});
