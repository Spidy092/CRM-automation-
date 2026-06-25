import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { Layout } from '../Layout';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({ data: { success: true } })
  }
}));

describe('Layout', () => {
  it('renders successfully', () => {
    const { container } = renderWithProviders(<Layout />);
    expect(container).toBeTruthy();
  });
});
