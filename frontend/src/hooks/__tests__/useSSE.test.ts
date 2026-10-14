import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSSE } from '../useSSE';
import { useAuthStore } from '@/store/authStore';
import { apiClient } from '@/api/client';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (event: any) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
    }
  }

  emit(type: string, eventData: any = {}) {
    const list = this.listeners[type] ?? [];
    for (const h of list) {
      h(eventData);
    }
  }

  close() {
    this.closed = true;
  }
}

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

describe('useSSE', () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
    useAuthStore.setState({
      user: { id: 'u1', name: 'Test User', email: 'test@example.com', role: 'admin' },
      accessToken: 'test-token',
      isAuthenticated: true,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalEventSource;
  });

  it('exchanges access token for ticket and connects to SSE', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { ticket: 'ticket-abc' } },
    } as any);

    const onNotification = vi.fn();
    const { result } = renderHook(() => useSSE(onNotification));

    expect(apiClient.post).toHaveBeenCalledWith(
      '/events/ticket',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(1);
    });

    const es = MockEventSource.instances[0];
    expect(es.url).toContain('/events?ticket=ticket-abc');

    act(() => {
      es.onopen?.();
    });

    expect(result.current.status).toBe('connected');

    const sampleNotification = {
      id: 'notif-1',
      type: 'lead_assigned',
      title: 'Assigned',
      message: 'New lead',
      timestamp: new Date().toISOString(),
    };

    act(() => {
      es.onmessage?.({ data: JSON.stringify(sampleNotification) });
    });

    expect(onNotification).toHaveBeenCalledWith(sampleNotification);
  });

  it('aborts in-flight ticket request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(apiClient.post).mockImplementation((_url, _data, config) => {
      capturedSignal = (config as { signal?: AbortSignal })?.signal;
      return new Promise(() => {}); // never resolves
    });

    const { unmount } = renderHook(() => useSSE(vi.fn()));

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('aborts in-flight ticket request and disconnects on logout', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(apiClient.post).mockImplementation((_url, _data, config) => {
      capturedSignal = (config as { signal?: AbortSignal })?.signal;
      return new Promise(() => {});
    });

    renderHook(() => useSSE(vi.fn()));

    expect(capturedSignal?.aborted).toBe(false);

    act(() => {
      useAuthStore.getState().logout();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('aborts pending ticket request when token changes', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(apiClient.post).mockImplementation((_url, _data, config) => {
      const sig = (config as { signal?: AbortSignal })?.signal;
      if (sig) signals.push(sig);
      return new Promise(() => {});
    });

    renderHook(() => useSSE(vi.fn()));

    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(false);

    act(() => {
      useAuthStore.setState({ accessToken: 'new-token' });
    });

    expect(signals[0].aborted).toBe(true);
    expect(signals.length).toBe(2);
    expect(signals[1].aborted).toBe(false);
  });

  it('calls onReconnect callback when connection recovers after drop', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { ticket: 'ticket-1' } },
    } as any);

    const onNotification = vi.fn();
    const onReconnect = vi.fn();

    renderHook(() => useSSE(onNotification, onReconnect));

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(1);
    });

    const es1 = MockEventSource.instances[0];

    // Initial connection open: onReconnect is NOT called
    act(() => {
      es1.onopen?.();
    });
    expect(onReconnect).not.toHaveBeenCalled();

    // Connection drops with error
    vi.useFakeTimers();
    try {
      act(() => {
        es1.onerror?.();
      });
      expect(es1.closed).toBe(true);

      // Advance timers to trigger reconnect
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, data: { ticket: 'ticket-2' } },
      } as any);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(MockEventSource.instances.length).toBe(2);

      const es2 = MockEventSource.instances[1];

      // Second connection opens (reconnection): onReconnect MUST be called immediately!
      act(() => {
        es2.onopen?.();
      });

      expect(onReconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onReconnect callback immediately on manual reconnect()', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { ticket: 'ticket-1' } },
    } as any);

    const onNotification = vi.fn();
    const onReconnect = vi.fn();

    const { result } = renderHook(() => useSSE(onNotification, { onReconnect }));

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(1);
    });

    act(() => {
      result.current.reconnect();
    });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects immediately without reconnect when stream_revoked event is received', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { ticket: 'ticket-revoke-test' } },
    } as any);

    const onNotification = vi.fn();
    const { result } = renderHook(() => useSSE(onNotification));

    await waitFor(() => {
      expect(MockEventSource.instances.length).toBe(1);
    });

    const es = MockEventSource.instances[0];
    act(() => {
      es.onopen?.();
    });
    expect(result.current.status).toBe('connected');

    act(() => {
      es.emit('stream_revoked', { data: JSON.stringify({ reason: 'Admin revoked' }) });
    });

    expect(result.current.status).toBe('disconnected');
    expect(es.closed).toBe(true);
  });
});

