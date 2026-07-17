import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/authStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

interface RefreshTokenResponse {
  accessToken: string;
  refreshToken?: string;
}

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let refreshAccessTokenPromise: Promise<string> | null = null;

function shouldClearSessionAfterRefreshFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return true;
  }

  const status = error.response?.status;
  if (status === 429 || (status !== undefined && status >= 500)) {
    return false;
  }

  return true;
}

async function refreshAccessToken(): Promise<string> {
  if (!refreshAccessTokenPromise) {
    refreshAccessTokenPromise = (async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        throw new Error('No refresh token');
      }

      const response = await axios.post<ApiResponse<RefreshTokenResponse>>(`${API_BASE_URL}/auth/refresh`, {
        refreshToken,
      });

      const { accessToken, refreshToken: newRefreshToken } = response.data.data;

      // Store new access token in memory via Zustand (never in localStorage)
      useAuthStore.getState().setAccessToken(accessToken);

      // Backend rotates refresh tokens on every use. Persist the replacement
      // before any concurrent retry can read the old revoked token.
      if (newRefreshToken) {
        localStorage.setItem('refreshToken', newRefreshToken);
      }

      return accessToken;
    })().finally(() => {
      refreshAccessTokenPromise = null;
    });
  }

  return refreshAccessTokenPromise;
}

export async function ensureAccessToken(): Promise<string> {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) {
    return accessToken;
  }

  return refreshAccessToken();
}

// Read token from Zustand store state (not localStorage — security requirement)
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !originalRequest.url?.includes('/auth/login') && !originalRequest.url?.includes('/auth/refresh')) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        if (shouldClearSessionAfterRefreshFailure(refreshError)) {
          localStorage.removeItem('refreshToken');
          useAuthStore.getState().logout();
          window.location.href = '/login';
        }

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}
