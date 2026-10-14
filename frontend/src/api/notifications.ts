/**
 * Notifications API client.
 *
 * All calls route through the shared apiClient (which attaches the Bearer
 * token and handles 401 refresh).  Never call fetch/axios directly from
 * components.
 */

import { apiClient, type ApiResponse } from './client';

export interface NotificationDto {
  id: string;
  type:
    | 'lead_assigned'
    | 'campaign_enrolled'
    | 'export_ready'
    | 'job_failed'
    | 'scraper_complete'
    | 'lead_scored'
    | 'reply_received'
    | 'approval_required'
    | 'follow_up_due'
    | 'automation_failed';
  title: string;
  message: string;
  metadata: Record<string, string | number>;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDto[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

// ── List ──────────────────────────────────────────────────────────────────

export interface ListNotificationsParams {
  limit?: number;
  cursor?: string;
  excludeDismissed?: boolean;
}

export async function fetchNotifications(
  params: ListNotificationsParams = {},
): Promise<NotificationPage> {
  const { limit = 50, cursor, excludeDismissed } = params;
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  if (excludeDismissed) query.set('excludeDismissed', 'true');

  const response = await apiClient.get<ApiResponse<NotificationDto[]>>(
    `/notifications?${query.toString()}`,
  );
  const { data: items, meta } = response.data;
  return {
    items: items ?? [],
    meta: {
      limit: (meta?.limit as number) ?? limit,
      hasMore: Boolean(meta?.hasMore),
      nextCursor: meta?.nextCursor as string | undefined,
    },
  };
}

// ── Unread count ──────────────────────────────────────────────────────────

export async function fetchUnreadCount(): Promise<number> {
  const response = await apiClient.get<ApiResponse<{ count: number }>>('/notifications/unread-count');
  return response.data.data?.count ?? 0;
}

// ── Mark read ─────────────────────────────────────────────────────────────

export async function markNotificationRead(id: string): Promise<NotificationDto> {
  const response = await apiClient.patch<ApiResponse<NotificationDto>>(
    `/notifications/${id}/read`,
  );
  return response.data.data;
}

// ── Mark all read ─────────────────────────────────────────────────────────

export async function markAllNotificationsRead(cutoffAt: string): Promise<{ updated: number }> {
  const response = await apiClient.post<ApiResponse<{ updated: number }>>(
    '/notifications/read-all',
    { cutoffAt },
  );
  return response.data.data;
}

// ── Dismiss ───────────────────────────────────────────────────────────────

export async function dismissNotification(id: string): Promise<NotificationDto> {
  const response = await apiClient.patch<ApiResponse<NotificationDto>>(
    `/notifications/${id}/dismiss`,
  );
  return response.data.data;
}
