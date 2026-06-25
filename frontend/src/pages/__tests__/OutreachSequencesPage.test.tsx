import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { OutreachSequencesPage } from '../OutreachSequencesPage';

vi.mock('@/api/client', () => {
  const genericData = Object.assign([], {
    items: [],
    meta: { limit: 10, hasMore: false },
  });

  return {
    apiClient: {
      get: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
    },
  };
});

describe('OutreachSequencesPage', () => {
  it('renders successfully', async () => {
    const { container } = renderWithProviders(<OutreachSequencesPage />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeTruthy();
  });

  it('shows page title', async () => {
    renderWithProviders(<OutreachSequencesPage />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('Outreach Sequences')).toBeTruthy();
  });
});
