import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from '../App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: { user: { id: '1', role: 'admin' } } } }),
    post: vi.fn().mockResolvedValue({ data: { success: true } })
  }
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
