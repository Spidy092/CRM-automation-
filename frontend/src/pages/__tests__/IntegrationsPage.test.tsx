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

function getSummaryCard() {
  return screen.getByText('Integration health summary').closest('.overflow-hidden') as HTMLElement;
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

  it('renders the health summary with counts', () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const summary = getSummaryCard();
    expect(summary).toBeInTheDocument();

    expect(within(summary).getByText('Total')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('Total').parentElement as HTMLElement).getByText('3'),
    ).toBeInTheDocument();

    expect(within(summary).getByText('Enabled')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('Enabled').parentElement as HTMLElement).getByText('2'),
    ).toBeInTheDocument();

    expect(within(summary).getByText('Connected')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('Connected').parentElement as HTMLElement).getByText('1'),
    ).toBeInTheDocument();

    expect(within(summary).getByText('Failed')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('Failed').parentElement as HTMLElement).getByText('1'),
    ).toBeInTheDocument();

    expect(within(summary).getByText('No credentials')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('No credentials').parentElement as HTMLElement).getByText(
        '1',
      ),
    ).toBeInTheDocument();

    expect(within(summary).getByText('Untested')).toBeInTheDocument();
    expect(
      within(within(summary).getByText('Untested').parentElement as HTMLElement).getByText('0'),
    ).toBeInTheDocument();
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

  it('bulk Test Connections button is present and opens the results dialog', async () => {
    vi.mocked(bulkTestIntegrations).mockResolvedValue(mockBulkResult);
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const button = screen.getByRole('button', { name: /test connections/i });
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

  it('toggles an integration and calls the update mutation', async () => {
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
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'int-openwa-1',
      input: { is_enabled: false },
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

  it('shows OpenWA credential fields and help text when editing', async () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    fireEvent.click(
      within(getCategorySection('Messaging')).getByRole('button', { name: /credentials/i }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/OpenWA Base URL/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Session ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Phone Numbers/i)).toBeInTheDocument();

    expect(
      screen.getByText('The root URL of your external OpenWA HTTP server.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('OpenWA API key used in the x-api-key header.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('WhatsApp session identifier managed by the OpenWA server.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'One or more WhatsApp sender numbers for rotation (E.164 format).',
      ),
    ).toBeInTheDocument();
  });

  it('saves OpenWA credentials and calls the update mutation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    vi.mocked(useUpdateIntegration).mockReturnValue({
      mutateAsync,
      isPending: false,
    } as any);

    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    fireEvent.click(
      within(getCategorySection('Messaging')).getByRole('button', { name: /credentials/i }),
    );

    fireEvent.change(screen.getByLabelText(/OpenWA Base URL/i), {
      target: { value: 'https://openwa.example.com' },
    });
    fireEvent.change(screen.getByLabelText(/API Key/i), {
      target: { value: 'secret-key' },
    });
    fireEvent.change(screen.getByLabelText(/Session ID/i), {
      target: { value: 'session-1' },
    });
    fireEvent.change(screen.getByLabelText(/Phone Numbers/i), {
      target: { value: '+1234567890, +0987654321' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save credentials/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'int-openwa-1',
      input: {
        credentials: {
          baseUrl: 'https://openwa.example.com',
          apiKey: 'secret-key',
          sessionId: 'session-1',
          numbers: ['+1234567890', '+0987654321'],
        },
      },
    });
  });

  it('opens the setup wizard from Add Integration', async () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const addButton = screen.getByRole('button', { name: /add integration/i });
    expect(addButton).toBeInTheDocument();
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Integration Setup')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Select a provider to configure'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Messaging' })).toBeInTheDocument();
  });

  it('opens the setup wizard for a specific integration via Setup button', async () => {
    mockUseIntegrations(mockIntegrations);
    renderWithProviders(<IntegrationsPage />);

    const setupButton = within(getCategorySection('Messaging')).getByRole('button', {
      name: 'Setup',
    });
    fireEvent.click(setupButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Integration Setup')).toBeInTheDocument();
    expect(within(dialog).getByText('Configure OpenWA')).toBeInTheDocument();
  });
});
