import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScraperConfigs, useCreateScraperConfig, useUpdateScraperConfig, useDeleteScraperConfig, useTriggerScrape, useScraperLogs } from '../scraper';
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

describe('scraper API', () => {
  it('renders useScraperConfigs successfully', () => {
    const { result } = renderHook(() => useScraperConfigs({} as any), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useCreateScraperConfig successfully', () => {
    const { result } = renderHook(() => useCreateScraperConfig(), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useUpdateScraperConfig successfully', () => {
    const { result } = renderHook(() => useUpdateScraperConfig(), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useDeleteScraperConfig successfully', () => {
    const { result } = renderHook(() => useDeleteScraperConfig(), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useTriggerScrape successfully', () => {
    const { result } = renderHook(() => useTriggerScrape(), { wrapper });
    expect(result.current).toBeDefined();
  });
  it('renders useScraperLogs successfully', () => {
    const { result } = renderHook(() => useScraperLogs({} as any), { wrapper });
    expect(result.current).toBeDefined();
  });
});
