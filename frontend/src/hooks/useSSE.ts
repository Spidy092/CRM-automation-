import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { apiClient } from '@/api/client';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export interface AppNotification {
  id: string;
  type:
    | 'lead_assigned'
    | 'campaign_enrolled'
    | 'export_ready'
    | 'job_failed'
    | 'scraper_complete'
    | 'lead_scored'
    | 'stream_revoked';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

type NotificationHandler = (n: AppNotification) => void;

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface UseSSEOptions {
  onReconnect?: () => void;
}

export function useSSE(
  onNotification: NotificationHandler,
  optionsOrReconnect?: (() => void) | UseSSEOptions,
): {
  disconnect: () => void;
  status: ConnectionStatus;
  reconnect: () => void;
} {
  const { isAuthenticated, accessToken } = useAuthStore();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticketAbortControllerRef = useRef<AbortController | null>(null);
  const backoffDelayRef = useRef(1_000);
  const isMountedRef = useRef(true);
  const hasConnectedOnceRef = useRef(false);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  const onReconnectCallback =
    typeof optionsOrReconnect === 'function'
      ? optionsOrReconnect
      : optionsOrReconnect?.onReconnect;
  const onReconnectRef = useRef(onReconnectCallback);
  onReconnectRef.current = onReconnectCallback;

  const disconnect = useCallback(() => {
    if (ticketAbortControllerRef.current) {
      ticketAbortControllerRef.current.abort();
      ticketAbortControllerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (isMountedRef.current) {
      setStatus('disconnected');
    }
  }, []);

  const connectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (!isMountedRef.current || !isAuthenticated || !accessToken) return;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

    // Bounded exponential backoff with jitter: 1s -> 2s -> 4s -> ... max 30s
    const jitter = Math.random() * 500;
    const delay = Math.min(backoffDelayRef.current + jitter, 30_000);
    backoffDelayRef.current = Math.min(backoffDelayRef.current * 2, 30_000);

    setStatus('connecting');
    reconnectTimerRef.current = setTimeout(() => {
      connectRef.current();
    }, delay);
  }, [isAuthenticated, accessToken]);

  const connect = useCallback(() => {
    if (!isAuthenticated || !accessToken || !isMountedRef.current) {
      disconnect();
      return;
    }
    if (esRef.current) return;

    if (ticketAbortControllerRef.current) {
      ticketAbortControllerRef.current.abort();
      ticketAbortControllerRef.current = null;
    }

    const abortController = new AbortController();
    ticketAbortControllerRef.current = abortController;

    setStatus('connecting');

    // EventSource can't send an Authorization header, so we exchange the
    // access token for a single-use, 30s ticket first.
    apiClient
      .post<{ success: boolean; data: { ticket: string } }>(
        '/events/ticket',
        undefined,
        { signal: abortController.signal },
      )
      .then(({ data }) => {
        if (abortController.signal.aborted) return;
        ticketAbortControllerRef.current = null;

        // Guard against race conditions if unmounted or disconnected in-flight
        if (!isMountedRef.current || !isAuthenticated || !accessToken || esRef.current) return;

        const url = `${API_BASE}/events?ticket=${encodeURIComponent(data.data.ticket)}`;
        const es = new EventSource(url);
        esRef.current = es;

        es.onopen = () => {
          if (!isMountedRef.current) {
            es.close();
            return;
          }
          const isReconnection = hasConnectedOnceRef.current;
          hasConnectedOnceRef.current = true;
          setStatus('connected');
          backoffDelayRef.current = 1_000;

          if (isReconnection) {
            onReconnectRef.current?.();
          }
        };

        es.onmessage = (event) => {
          try {
            const notification = JSON.parse(event.data as string) as AppNotification;
            if (notification.type === 'stream_revoked') {
              disconnect();
              return;
            }
            onNotificationRef.current(notification);
          } catch {
            // ignore parse errors
          }
        };

        es.addEventListener('stream_revoked', () => {
          disconnect();
        });

        es.onerror = () => {
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          if (isMountedRef.current && isAuthenticated && accessToken) {
            scheduleReconnect();
          }
        };
      })
      .catch((err: unknown) => {
        if (
          abortController.signal.aborted ||
          (err as { name?: string })?.name === 'CanceledError' ||
          (err as { code?: string })?.code === 'ERR_CANCELED'
        ) {
          return;
        }
        ticketAbortControllerRef.current = null;
        if (isMountedRef.current && isAuthenticated && accessToken) {
          scheduleReconnect();
        }
      });
  }, [isAuthenticated, accessToken, disconnect, scheduleReconnect]);
  connectRef.current = connect;

  const reconnect = useCallback(() => {
    backoffDelayRef.current = 1_000;
    disconnect();
    onReconnectRef.current?.();
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    isMountedRef.current = true;
    if (isAuthenticated && accessToken) {
      connect();
    } else {
      hasConnectedOnceRef.current = false;
      disconnect();
    }

    return () => {
      isMountedRef.current = false;
      disconnect();
    };
  }, [isAuthenticated, accessToken, connect, disconnect]);

  useEffect(() => {
    const handleLogout = () => {
      hasConnectedOnceRef.current = false;
      disconnect();
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [disconnect]);

  useEffect(() => {
    const handleOnline = () => {
      if (status !== 'connected' && isAuthenticated && accessToken) {
        reconnect();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [status, isAuthenticated, accessToken, reconnect]);

  return { disconnect, status, reconnect };
}
