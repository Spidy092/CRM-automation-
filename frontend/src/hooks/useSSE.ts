import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { apiClient } from '@/api/client';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export interface AppNotification {
  id: string;
  type: 'lead_assigned' | 'campaign_enrolled' | 'export_ready' | 'job_failed' | 'scraper_complete' | 'lead_scored';
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

type NotificationHandler = (n: AppNotification) => void;

export function useSSE(onNotification: NotificationHandler): { disconnect: () => void } {
  const { isAuthenticated, accessToken } = useAuthStore();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  const connect = useCallback(() => {
    if (!isAuthenticated || !accessToken) return;
    if (esRef.current) return;

    // EventSource can't send an Authorization header, so we exchange the
    // access token for a single-use, 30s ticket first — that's what ends up
    // in the URL (and therefore access logs/browser history), not the
    // long-lived access token itself.
    apiClient
      .post<{ success: boolean; data: { ticket: string } }>('/events/ticket')
      .then(({ data }) => {
        if (esRef.current) return;
        const url = `${API_BASE}/events?ticket=${encodeURIComponent(data.data.ticket)}`;
        const es = new EventSource(url);
        esRef.current = es;

        es.onmessage = (event) => {
          try {
            const notification = JSON.parse(event.data as string) as AppNotification;
            onNotificationRef.current(notification);
          } catch {
            // ignore parse errors
          }
        };

        es.onerror = () => {
          es.close();
          esRef.current = null;
          // Reconnect after 5 seconds
          reconnectTimerRef.current = setTimeout(connect, 5_000);
        };
      })
      .catch(() => {
        // Couldn't mint a ticket (e.g. network blip) — retry after 5 seconds
        reconnectTimerRef.current = setTimeout(connect, 5_000);
      });
  }, [isAuthenticated, accessToken]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    esRef.current?.close();
    esRef.current = null;
  }, []);

  return { disconnect };
}
