import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('keeps AI approvals in the Copilot panel rather than the sidebar', () => {
    renderWithProviders(<Layout />);

    expect(screen.queryByRole('link', { name: 'AI Copilot Inbox' })).not.toBeInTheDocument();
  });
});
