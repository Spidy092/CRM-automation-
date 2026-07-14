import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import React from 'react';
import { useTeamMetrics } from '../teamMetrics';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../client', () => ({
  apiClient: {
    get: mockGet,
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

describe('teamMetrics API', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            user_id: 'u1',
            name: 'Alice',
            assigned_count: 10,
            contacted_count: 5,
            contacted_pct: 50,
            avg_response_time: 3600,
            total_activities: 8,
          },
        ],
      },
    });
  });

  it('renders useTeamMetrics successfully', () => {
    const { result } = renderHook(() => useTeamMetrics(), { wrapper });
    expect(result.current).toBeDefined();
  });

  it('calls /team/metrics with provided filters', async () => {
    const from = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const to = new Date('2025-01-31T23:59:59.999Z').toISOString();
    const stage = 'stage-123';

    renderHook(() => useTeamMetrics(from, to, stage), { wrapper });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/team/metrics', {
        params: { from, to, stage },
      });
    });
  });
});
