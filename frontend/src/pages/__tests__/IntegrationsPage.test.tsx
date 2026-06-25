import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { IntegrationsPage } from '../IntegrationsPage';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { data: [], meta: { total: 0 } } }),
    put: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
  },
}));

vi.mock('@/api/integrations', () => ({
  useIntegrations: vi.fn().mockReturnValue({
    data: { items: [], meta: { total: 0, hasMore: false } },
    isLoading: false,
    error: null,
  }),
  useUpdateIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useTestIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Connection successful' }),
    isPending: false,
  }),
}));

describe('IntegrationsPage', () => {
  it('renders the page header', () => {
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByText('Integrations')).toBeDefined();
  });

  it('shows empty state when no integrations', () => {
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByText('No integrations configured')).toBeDefined();
  });
});
