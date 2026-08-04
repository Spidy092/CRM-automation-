import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  screen,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { IntegrationsPage } from '../IntegrationsPage';
import {
  useIntegrations,
  useUpdateIntegration,
  useTestIntegration,
  bulkTestIntegrations,
  type Integration,
  type BulkTestResult,
} from '@/api/integrations';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { data: [], meta: { total: 0 } } }),
    put: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: { data: {} } }),
  },
}));

vi.mock('@/api/integrations', () => ({
  useIntegrations: vi.fn().mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  }),
  useUpdateIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useTestIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({
      ok: true,
      message: 'Connection successful',
      status: 'ok',
      tested_at: '2026-06-27T11:00:00Z',
    }),
    isPending: false,
  }),
  useBulkTestIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  bulkTestIntegrations: vi.fn().mockResolvedValue({}),
}));

const mockIntegrations: Integration[] = [
  {
    id: 'int-openwa-1',
    name: 'openwa',
    display_name: 'OpenWA',
    is_enabled: true,
    last_tested_at: '2026-06-27T10:00:00Z',
    last_test_status: 'ok',
    updated_by: null,
    updated_at: '2026-06-27T10:00:00Z',
  },
  {
    id: 'int-sheets-1',
    name: 'google_sheets',
    display_name: 'Google Sheets',
    is_enabled: false,
    last_tested_at: null,
    last_test_status: 'no_credentials',
    updated_by: null,
    updated_at: '2026-06-27T10:00:00Z',
  },
  {
    id: 'int-ads-1',
    name: 'google_ads',
    display_name: 'Google Ads',
    is_enabled: true,
    last_tested_at: '2026-06-27T10:00:00Z',
    last_test_status: 'failed',
    updated_by: null,
    updated_at: '2026-06-27T10:00:00Z',
  },
];

const mockBulkResult: BulkTestResult = {
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  results: [
    {
      id: 'int-openwa-1',
      name: 'OpenWA',
      ok: true,
      status: 'ok',
      message: 'Connected',
      tested_at: '2026-06-27T11:00:00Z',
    },
    {
      id: 'int-ads-1',
      name: 'Google Ads',
      ok: false,
      status: 'failed',
      message: 'Invalid token',
      tested_at: '2026-06-27T11:00:00Z',
    },
  ],
};

function mockUseIntegrations(
  data: Integration[] | null = [],
  isLoading = false,
  error: Error | null = null,
) {
  vi.mocked(useIntegrations).mockReturnValue({
    data,
    isLoading,
    error,
  } as any);
}

function getCategorySection(name: string) {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

describe('IntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIntegrations([], false, null);
  });

  it('renders the page header', () => {
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
  });

  it('shows empty state when no integrations', () => {
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByText('No integrations found')).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    mockUseIntegrations(null, true, null);
    renderWithProviders(<IntegrationsPage />);
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.queryByText('No integrations found')).not.toBeInTheDocument();
  });

  it('shows the error state', () => {
    mockUseIntegrations([], false, new Error('Network error'));
    renderWithProviders(<IntegrationsPage />);
    expect(
      screen.getByText('Failed to load integrations. Please try again.'),
    ).toBeInTheDocument();
  });

  it('renders the health summary bar with counts', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    expect(screen.getByText(/Healthy|Needs attention/)).toBeInTheDocument();
    expect(screen.getByText(/enabled/)).toBeInTheDocument();
    expect(screen.getByText(/connected/)).toBeInTheDocument();
  });

  it('renders category headings and groups cards by category', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    expect(screen.getByRole('heading', { name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Productivity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Advertising' })).toBeInTheDocument();

    expect(within(getCategorySection('Messaging')).getByText('OpenWA')).toBeInTheDocument();
    expect(
      within(getCategorySection('Productivity')).getByText('Google Sheets'),
    ).toBeInTheDocument();
    expect(
      within(getCategorySection('Advertising')).getByText('Google Ads'),
    ).toBeInTheDocument();
  });

  it('bulk Test All button is present and opens the results dialog', async () => {
    vi.mocked(bulkTestIntegrations).mockResolvedValue(mockBulkResult);
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const button = screen.getByRole('button', { name: /test all/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Connection Test Results')).toBeInTheDocument();
    expect(
      within(dialog).getByText('2 providers tested · 1 passed · 1 failed · 0 skipped'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('OpenWA')).toBeInTheDocument();
    expect(within(dialog).getByText('Google Ads')).toBeInTheDocument();
    expect(within(dialog).getByText('Invalid token')).toBeInTheDocument();
  });

  it('shows confirmation dialog when disabling an integration', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useUpdateIntegration).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as any);

    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const toggleButton = within(getCategorySection('Messaging')).getByRole('button', {
      name: 'Enabled',
    });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: /disable/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'int-openwa-1',
      input: { is_enabled: false },
    });
  });

  it('enables a disabled integration without confirmation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useUpdateIntegration).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as any);

    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const toggleButton = within(getCategorySection('Productivity')).getByRole('button', {
      name: 'Disabled',
    });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'int-sheets-1',
      input: { is_enabled: true },
    });
  });

  it('tests a single integration and calls the test mutation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      ok: true,
      message: 'Connection successful',
      status: 'ok',
      tested_at: '2026-06-27T11:00:00Z',
    });
    vi.mocked(useTestIntegration).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as any);

    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const testButton = within(getCategorySection('Messaging')).getByRole('button', {
      name: /^Test$/i,
    });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith('int-openwa-1');
  });

  it('opens the setup wizard via Configure button', async () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const configureButton = within(getCategorySection('Messaging')).getByRole('button', {
      name: 'Configure',
    });
    fireEvent.click(configureButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Integration Setup')).toBeInTheDocument();
    expect(within(dialog).getByText('Configure OpenWA')).toBeInTheDocument();
  });

  it('filters integrations by search query', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    fireEvent.change(searchInput, { target: { value: 'sheets' } });

    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
    expect(screen.queryByText('OpenWA')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Ads')).not.toBeInTheDocument();
  });

  it('filters integrations by category tab', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const advertisingTab = screen.getByRole('button', { name: 'Advertising' });
    fireEvent.click(advertisingTab);

    expect(screen.getByText('Google Ads')).toBeInTheDocument();
    expect(screen.queryByText('OpenWA')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Sheets')).not.toBeInTheDocument();
  });

  it('shows no-match message when search has no results', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const searchInput = screen.getByPlaceholderText('Search integrations...');
    fireEvent.change(searchInput, { target: { value: 'zzz-nonexistent' } });

    expect(screen.getByText('No integrations match your search.')).toBeInTheDocument();
  });
});
