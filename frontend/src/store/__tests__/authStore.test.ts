import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../authStore';
import type { UserRole } from '@/types';

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should initialize with default state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it('should handle setUser properly', () => {
    const mockUser = { id: '1', name: 'Test', email: 'test@example.com', role: 'admin' as UserRole };
    
    useAuthStore.getState().setUser(mockUser);
    
    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
  });

  it('should handle setUser with null properly', () => {
    useAuthStore.setState({ isAuthenticated: true });
    
    useAuthStore.getState().setUser(null);
    
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('should handle setAccessToken', () => {
    useAuthStore.getState().setAccessToken('mock-token');
    expect(useAuthStore.getState().accessToken).toBe('mock-token');
    
    useAuthStore.getState().setAccessToken(null);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('should login, set tokens, and persist refreshToken in localStorage', () => {
    const mockUser = { id: '1', name: 'Test', email: 'test@example.com', role: 'sales_rep' as UserRole };
    const accessToken = 'access-123';
    const refreshToken = 'refresh-456';

    useAuthStore.getState().login(mockUser, accessToken, refreshToken);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.accessToken).toBe(accessToken);
    expect(state.isAuthenticated).toBe(true);
    
    expect(localStorage.getItem('refreshToken')).toBe(refreshToken);
    // Access token should NOT be in localStorage
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('should logout and clear localStorage', () => {
    localStorage.setItem('refreshToken', 'refresh-456');
    useAuthStore.setState({
      user: { id: '1', name: 'Test', email: 'test@example.com', role: 'sales_rep' as UserRole },
      accessToken: 'access-123',
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('should handle setLoading', () => {
    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
    
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);
  });
});
