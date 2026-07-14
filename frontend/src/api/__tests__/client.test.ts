import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

const mocks = vi.hoisted(() => {
  const handlers: {
    responseError?: (error: unknown) => Promise<unknown>;
  } = {};

  const apiInstance = vi.fn(async (config: unknown) => ({ data: { success: true, data: config } }));
  apiInstance.interceptors = {
    request: {
      use: vi.fn(),
    },
    response: {
      use: vi.fn((_success, error) => {
        handlers.responseError = error;
        return 0;
      }),
    },
  };

  return {
    handlers,
    apiInstance,
    create: vi.fn(() => apiInstance),
    post: vi.fn(),
    isAxiosError: vi.fn((error: unknown) => Boolean((error as { isAxiosError?: boolean }).isAxiosError)),
  };
});

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
    post: mocks.post,
    isAxiosError: mocks.isAxiosError,
  },
}));

describe('apiClient auth refresh interceptor', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    mocks.handlers.responseError = undefined;
    mocks.apiInstance.mockClear();
    mocks.create.mockClear();
    mocks.post.mockReset();
    mocks.isAxiosError.mockClear();
  });

  it('shares one refresh request across concurrent 401 responses', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,
    });

    localStorage.setItem('refreshToken', 'refresh-old');
    mocks.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
        },
      },
    });

    await import('../client');
    expect(mocks.handlers.responseError).toBeDefined();

    const makeUnauthorizedError = () => ({
      response: { status: 401 },
      config: { headers: {} },
    });

    await Promise.all([
      mocks.handlers.responseError!(makeUnauthorizedError()),
      mocks.handlers.responseError!(makeUnauthorizedError()),
    ]);

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith('/api/v1/auth/refresh', {
      refreshToken: 'refresh-old',
    });
    expect(localStorage.getItem('refreshToken')).toBe('refresh-new');
    expect(useAuthStore.getState().accessToken).toBe('access-new');
    expect(mocks.apiInstance).toHaveBeenCalledTimes(2);
    expect(mocks.apiInstance).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ headers: { Authorization: 'Bearer access-new' } }),
    );
    expect(mocks.apiInstance).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ headers: { Authorization: 'Bearer access-new' } }),
    );
  });

  it('keeps the refresh token when refresh is temporarily rate limited', async () => {
    const { useAuthStore } = await import('@/store/authStore');
    useAuthStore.setState({
      user: { id: '1', name: 'User', email: 'user@example.com', role: 'admin' },
      accessToken: null,
      isAuthenticated: true,
      isLoading: false,
    });

    localStorage.setItem('refreshToken', 'refresh-current');
    mocks.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 429 },
    });

    await import('../client');

    await expect(
      mocks.handlers.responseError!({
        response: { status: 401 },
        config: { headers: {} },
      }),
    ).rejects.toMatchObject({ response: { status: 429 } });

    expect(localStorage.getItem('refreshToken')).toBe('refresh-current');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
