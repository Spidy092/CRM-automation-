import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/pages/TemplatesPage', () => ({
  TemplatesPage: () => <div>Templates destination</div>,
}));

vi.mock('@/components/ChatWidget', () => ({
  ChatWidget: () => null,
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: { id: '1', name: 'Admin', email: 'admin@example.com', role: 'admin' } } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
  ensureAccessToken: vi.fn().mockResolvedValue('access'),
}));

describe('App', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    useAuthStore.getState().setUser(null);
    useAuthStore.getState().setLoading(true);
  });

  it('renders successfully', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
    expect(container).toBeTruthy();
  });

  it.each(['/messages', '/messages/snippet-1'])('redirects legacy route %s to Templates', async (path) => {
    window.history.replaceState({}, '', path);
    useAuthStore.getState().setUser({ id: '1', name: 'Admin', email: 'admin@example.com', role: 'admin' });
    useAuthStore.getState().setLoading(false);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Templates destination')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/templates'));
  });
});
