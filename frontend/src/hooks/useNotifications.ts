/**
 * TanStack Query hooks for durable notification history.
 *
 * Design principles:
 * - Server state (history, unread count) lives in TanStack Query cache only.
 * - Only panel open/close and active filter belong in local UI state.
 * - Unread count is derived from the server, never maintained as a local
 *   counter, so it never drifts due to duplicate SSE signals.
 * - On live SSE event: invalidate the queries so they re-fetch from the DB;
 *   this also covers the reconciliation race (initial history load ↔ SSE).
 * - Background polling at 5 min interval acts as the bounded background
 *   reconciliation cadence; focus-refetch handles tab switching.
 * - Duplicate prevention: deduplication is enforced by the server's
 *   occurrence_key constraint; the client only calls invalidate() once per
 *   SSE event, not per notification field.
 */

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  type NotificationDto,
  type ListNotificationsParams,
} from '@/api/notifications';

// ── Query keys ─────────────────────────────────────────────────────────────

export const notificationKeys = {
  all: (userId?: string) =>
    userId ? (['notifications', userId] as const) : (['notifications'] as const),
  list: (userId: string | undefined, params: ListNotificationsParams) =>
    ['notifications', userId ?? 'anonymous', 'list', params] as const,
  unreadCount: (userId?: string) =>
    ['notifications', userId ?? 'anonymous', 'unread-count'] as const,
};

// ── Queries ────────────────────────────────────────────────────────────────

const BACKGROUND_REFETCH_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Infinite-query hook for the notification inbox (cursor-paginated).
 * Does NOT automatically mark items read on load.
 * Scoped by current authenticated user; disabled when unauthenticated.
 */
export function useNotifications(params: Omit<ListNotificationsParams, 'cursor'> = {}) {
  const user = useAuthStore((s) => s.user);
  return useInfiniteQuery({
    queryKey: notificationKeys.list(user?.id, params),
    queryFn: ({ pageParam }) =>
      fetchNotifications({ ...params, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: BACKGROUND_REFETCH_MS,
  });
}

/**
 * Hook for the authoritative unread count.
 * Uses short staleTime so the badge updates quickly on focus/reconnect.
 * Scoped by current authenticated user; disabled when unauthenticated.
 */
export function useUnreadCount() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: notificationKeys.unreadCount(user?.id),
    queryFn: fetchUnreadCount,
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: BACKGROUND_REFETCH_MS,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

/** Invalidates both list and count after any mutation for the current user. */
function useInvalidateNotifications() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return () => {
    void qc.invalidateQueries({ queryKey: notificationKeys.all(user?.id) });
  };
}

export function useMarkRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidate,
  });
}

export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (cutoffAt: string) => markAllNotificationsRead(cutoffAt),
    onSuccess: invalidate,
  });
}

export function useDismiss() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: invalidate,
  });
}

// ── Live event reconciliation ──────────────────────────────────────────────

/**
 * Call this from useSSE's onNotification handler.
 *
 * When a live SSE notification arrives, we invalidate the server-side queries
 * rather than pushing the notification directly into the list.  This ensures:
 *   1. Deduplication by server occurrence_key (no client-side counter inflation).
 *   2. The history and unread count are always in sync with PostgreSQL.
 *   3. Events that arrived while the SSE was disconnected are recovered.
 */
export function useInvalidateOnLiveEvent() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return () => {
    void qc.invalidateQueries({ queryKey: notificationKeys.all(user?.id) });
  };
}

/**
 * Automatically evicts cached notification queries on logout or user switch.
 * Ensures cross-account cache isolation so that switching accounts never leaks
 * the prior user's notification list or badge count.
 */
export function useClearNotificationsOnLogout() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const prevUserRef = useRef(user);

  useEffect(() => {
    if (prevUserRef.current && (!user || prevUserRef.current.id !== user.id)) {
      qc.removeQueries({ queryKey: ['notifications'] });
    }
    prevUserRef.current = user;
  }, [user, qc]);

  useEffect(() => {
    const handleLogout = () => {
      qc.removeQueries({ queryKey: ['notifications'] });
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [qc]);
}

/**
 * Manually evict all notification queries from the given QueryClient instance.
 */
export function clearNotificationsCache(qc: ReturnType<typeof useQueryClient>) {
  qc.removeQueries({ queryKey: ['notifications'] });
}

/**
 * Type guard for validating that a live SSE event looks like a notification.
 * Prevents malformed payloads from inflating local state.
 */
export function isValidNotificationPayload(payload: unknown): payload is NotificationDto {
  if (typeof payload !== 'object' || payload === null) return false;
  const n = payload as Record<string, unknown>;
  return (
    typeof n['id'] === 'string' &&
    typeof n['type'] === 'string' &&
    typeof n['title'] === 'string' &&
    typeof n['message'] === 'string' &&
    typeof n['createdAt'] === 'string'
  );
}
