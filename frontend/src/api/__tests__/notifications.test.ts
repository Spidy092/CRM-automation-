import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '../client';
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  type NotificationDto,
} from '../notifications';

vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('notifications API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockItem: NotificationDto = {
    id: 'n-1',
    type: 'lead_assigned',
    title: 'Lead assigned',
    message: 'Acme was assigned',
    metadata: { leadId: 'lead-1' },
    readAt: null,
    dismissedAt: null,
    createdAt: '2026-10-09T10:00:00.000Z',
  };

  describe('fetchNotifications', () => {
    it('calls GET /notifications with default params', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          success: true,
          data: [mockItem],
          meta: { limit: 50, hasMore: false },
        },
      } as any);

      const result = await fetchNotifications();

      expect(apiClient.get).toHaveBeenCalledWith('/notifications?limit=50');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(mockItem);
      expect(result.meta.hasMore).toBe(false);
    });

    it('passes limit, cursor, and excludeDismissed in query string', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          success: true,
          data: [mockItem],
          meta: { limit: 10, hasMore: true, nextCursor: 'cur123' },
        },
      } as any);

      const result = await fetchNotifications({
        limit: 10,
        cursor: 'prev-cur',
        excludeDismissed: true,
      });

      expect(apiClient.get).toHaveBeenCalledWith(
        '/notifications?limit=10&cursor=prev-cur&excludeDismissed=true',
      );
      expect(result.meta.nextCursor).toBe('cur123');
      expect(result.meta.hasMore).toBe(true);
    });
  });

  describe('fetchUnreadCount', () => {
    it('calls GET /notifications/unread-count and returns count', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          success: true,
          data: { count: 5 },
        },
      } as any);

      const count = await fetchUnreadCount();

      expect(apiClient.get).toHaveBeenCalledWith('/notifications/unread-count');
      expect(count).toBe(5);
    });

    it('defaults to 0 when data is missing', async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          success: true,
          data: null,
        },
      } as any);

      const count = await fetchUnreadCount();
      expect(count).toBe(0);
    });
  });

  describe('markNotificationRead', () => {
    it('calls PATCH /notifications/:id/read', async () => {
      const readItem = { ...mockItem, readAt: '2026-10-09T10:05:00.000Z' };
      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        data: {
          success: true,
          data: readItem,
        },
      } as any);

      const result = await markNotificationRead('n-1');

      expect(apiClient.patch).toHaveBeenCalledWith('/notifications/n-1/read');
      expect(result.readAt).toBe('2026-10-09T10:05:00.000Z');
    });
  });

  describe('markAllNotificationsRead', () => {
    it('calls POST /notifications/read-all with snapshot cutoffAt', async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          success: true,
          data: { updated: 3 },
        },
      } as any);

      const cutoff = '2026-10-09T10:10:00.000Z';
      const result = await markAllNotificationsRead(cutoff);

      expect(apiClient.post).toHaveBeenCalledWith('/notifications/read-all', {
        cutoffAt: cutoff,
      });
      expect(result.updated).toBe(3);
    });
  });

  describe('dismissNotification', () => {
    it('calls PATCH /notifications/:id/dismiss', async () => {
      const dismissedItem = { ...mockItem, dismissedAt: '2026-10-09T10:12:00.000Z' };
      vi.mocked(apiClient.patch).mockResolvedValueOnce({
        data: {
          success: true,
          data: dismissedItem,
        },
      } as any);

      const result = await dismissNotification('n-1');

      expect(apiClient.patch).toHaveBeenCalledWith('/notifications/n-1/dismiss');
      expect(result.dismissedAt).toBe('2026-10-09T10:12:00.000Z');
    });
  });
});
