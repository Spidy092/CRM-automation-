import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDashboardMetrics, useExportReport } from '../reports';
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
});
