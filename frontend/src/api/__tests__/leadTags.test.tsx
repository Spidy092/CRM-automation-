import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useLeadTags } from '../leads';
import { useAuthStore } from '@/store/authStore';

vi.mock('../client', () => ({ apiClient: { get: vi.fn() } }));

describe('lead tag cache isolation', () => {
  afterEach(() => {
    useAuthStore.getState().setUser(null);
    vi.resetAllMocks();
  });

  it.each(['different-user', 'same-user'] as const)(
    'does not expose cached administrator tags when switching to sales (%s) and fetching fails',
    async (identity) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      useAuthStore.getState().setUser({ id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin' });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { success: true, data: ['admin-private-tag'] } });
      const { result, unmount } = renderHook(() => useLeadTags(), { wrapper });
      try {
        await waitFor(() => expect(result.current.data).toEqual(['admin-private-tag']));
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Request failed'));
        act(() => useAuthStore.getState().setUser({
          id: identity === 'same-user' ? 'admin-1' : 'sales-1',
          name: 'Sales', email: 'sales@example.com', role: 'sales',
        }));
        expect(result.current.data).toBeUndefined();
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.data).toBeUndefined();
        expect(apiClient.get).toHaveBeenCalledTimes(2);
      } finally {
        unmount();
        client.clear();
      }
    },
  );
});
