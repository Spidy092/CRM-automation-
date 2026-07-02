import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';
import { usePlan, useApprovePlan, useCancelPlan } from '../agentPlans';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient as api } from '../client';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
};

describe('agentPlans api client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('usePlan fetches plan preview', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          plan: { id: 'plan-1' },
          steps: [],
          estimatedCostCents: 5,
          requiresApproval: true,
        },
      },
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => usePlan('plan-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.plan.id).toBe('plan-1');
  });

  it('useApprovePlan posts to approve endpoint', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: { planId: 'plan-1', status: 'running' },
      },
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useApprovePlan(), { wrapper });
    result.current.mutate('plan-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('useCancelPlan posts to cancel endpoint', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCancelPlan(), { wrapper });
    result.current.mutate('plan-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
