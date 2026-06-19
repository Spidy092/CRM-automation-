import { create } from 'zustand';
import type { UserRole } from '@/types';

interface LoginUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AuthState {
  user: LoginUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: LoginUser | null) => void;
  setAccessToken: (token: string | null) => void;
  login: (user: LoginUser, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // Access token stored ONLY in memory — never in localStorage (security requirement)
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  setAccessToken: (accessToken) => set({ accessToken }),

  login: (user, accessToken, refreshToken) => {
    // Only refreshToken is persisted — access token stays in memory only
    localStorage.setItem('refreshToken', refreshToken);
    set({ user, accessToken, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('refreshToken');
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  setLoading: (isLoading) => set({ isLoading }),
}));
