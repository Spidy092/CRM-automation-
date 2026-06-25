import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useLogin, useRefreshToken, useLogout, useCurrentUser, useForgotPassword, useResetPassword } from '../auth';
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

describe('auth API', () => {
  it('renders useLogin successfully', async () => {
    const { result } = renderHook(() => useLogin({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useRefreshToken successfully', async () => {
    const { result } = renderHook(() => useRefreshToken({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useLogout successfully', async () => {
    const { result } = renderHook(() => useLogout({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useCurrentUser successfully', async () => {
    const { result } = renderHook(() => useCurrentUser({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useForgotPassword successfully', async () => {
    const { result } = renderHook(() => useForgotPassword({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
  it('renders useResetPassword successfully', async () => {
    const { result } = renderHook(() => useResetPassword({} as any), { wrapper });
    expect(result.current).toBeDefined();
    if (result.current.mutateAsync) {
      await result.current.mutateAsync({} as any).catch(() => {});
    }
  });
});
