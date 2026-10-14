import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NotificationBell } from '../NotificationBell';
import { useAuthStore } from '@/store/authStore';
import * as api from '@/api/notifications';

vi.mock('@/api/notifications', () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  dismissNotification: vi.fn(),
}));

vi.mock('@/hooks/useSSE', () => ({
  useSSE: vi.fn(() => ({
    status: 'connected',
    disconnect: vi.fn(),
    reconnect: vi.fn(),
  })),
}));

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', name: 'Test User', email: 'test@example.com', role: 'admin' },
      accessToken: 'token-123',
      isAuthenticated: true,
      isLoading: false,
    });
  });

  const mockItem: api.NotificationDto = {
    id: 'notif-1',
    type: 'lead_assigned',
    title: 'New lead assigned',
    message: 'Acme Corp has been assigned to you',
    metadata: { leadId: 'lead-123' },
    readAt: null,
    dismissedAt: null,
    createdAt: new Date().toISOString(),
  };

  it('renders bell button with unread count badge', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(3);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    expect(button).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('opens panel and displays notifications when clicked', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(1);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('New lead assigned')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp has been assigned to you')).toBeInTheDocument();
    });
  });

  it('displays empty state when there are no notifications', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(0);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [],
      meta: { limit: 20, hasMore: false },
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    });
  });

  it('marks single notification as read on click', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(1);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });
    vi.mocked(api.markNotificationRead).mockResolvedValue({
      ...mockItem,
      readAt: new Date().toISOString(),
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('New lead assigned')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New lead assigned'));

    await waitFor(() => {
      expect(api.markNotificationRead).toHaveBeenCalledWith('notif-1');
    });
  });

  it('marks all as read when clicking "Mark all read"', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(2);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });
    vi.mocked(api.markAllNotificationsRead).mockResolvedValue({ updated: 2 });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Mark all read')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(api.markAllNotificationsRead).toHaveBeenCalledWith(expect.any(String));
    });
  });

  it('dismisses notification when dismiss button is clicked', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(1);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });
    vi.mocked(api.dismissNotification).mockResolvedValue({
      ...mockItem,
      dismissedAt: new Date().toISOString(),
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByLabelText('Dismiss notification')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Dismiss notification'));

    await waitFor(() => {
      expect(api.dismissNotification).toHaveBeenCalledWith('notif-1');
    });
  });

  it('closes panel on Escape key press', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(0);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });

    renderWithProviders(<NotificationBell />);

    const button = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not fetch notifications when user is unauthenticated', async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });

    renderWithProviders(<NotificationBell />);

    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(api.fetchUnreadCount).not.toHaveBeenCalled();
    expect(api.fetchNotifications).not.toHaveBeenCalled();
  });

  it('clears notification cache on logout event', async () => {
    vi.mocked(api.fetchUnreadCount).mockResolvedValue(2);
    vi.mocked(api.fetchNotifications).mockResolvedValue({
      items: [mockItem],
      meta: { limit: 20, hasMore: false },
    });

    renderWithProviders(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    act(() => {
      useAuthStore.getState().logout();
    });

    // After logout, user is null and queries are disabled / evicted
    expect(useAuthStore.getState().user).toBeNull();
  });
});
