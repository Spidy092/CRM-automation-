import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from '../App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: { id: '1', name: 'Admin', email: 'admin@example.com', role: 'admin' } } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
  ensureAccessToken: vi.fn().mockResolvedValue('access'),
}));

describe('App', () => {
  it('renders successfully', () => {
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );
    expect(container).toBeTruthy();
  });
});
