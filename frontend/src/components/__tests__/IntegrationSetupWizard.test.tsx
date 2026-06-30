import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { IntegrationSetupWizard } from '../IntegrationSetupWizard';
import {
  useIntegrations,
  useUpdateIntegration,
  useTestIntegration,
  useBulkTestIntegration,
  type Integration,
  type TestIntegrationResult,
} from '@/api/integrations';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({
      data: {
        data: {
          ok: true,
          status: 'ok',
          message: 'Connection verified',
          tested_at: '2026-06-27T11:00:00Z',
        },
      },
    }),
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
      status: 'ok',
      message: 'Connection verified',
      tested_at: '2026-06-27T11:00:00Z',
    }),
    isPending: false,
  }),
  useBulkTestIntegration: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

const showToastMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/Toast', async () => {
  const actual = await vi.importActual('@/components/ui/Toast');
  return {
    ...actual,
    useToast: vi.fn().mockReturnValue({ showToast: showToastMock }),
  };
});

const openwaIntegration: Integration = {
  id: 'int-openwa-1',
  name: 'openwa',
  display_name: 'OpenWA',
  is_enabled: false,
  last_tested_at: null,
  last_test_status: null,
  updated_by: null,
  updated_at: '2026-06-27T10:00:00Z',
};

const sheetsIntegration: Integration = {
  id: 'int-sheets-1',
  name: 'google_sheets',
  display_name: 'Google Sheets',
  is_enabled: false,
  last_tested_at: null,
  last_test_status: null,
  updated_by: null,
  updated_at: '2026-06-27T10:00:00Z',
};

const mockIntegrations: Integration[] = [openwaIntegration, sheetsIntegration];

function setupIntegrationsMock(data: Integration[] | null = mockIntegrations) {
  (useIntegrations as Mock).mockReturnValue({
    data,
    isLoading: false,
    error: null,
  });
}

function setupUpdateMutationMock(mutateAsync = vi.fn().mockResolvedValue({})) {
  (useUpdateIntegration as Mock).mockReturnValue({
    mutateAsync,
    isPending: false,
  });
}

function fillOpenwaCredentials() {
  const baseUrl = screen.getByLabelText(/OpenWA Base URL/i);
  const apiKey = screen.getByLabelText(/API Key/i);
  const sessionId = screen.getByLabelText(/Session ID/i);
  const numbers = screen.getByLabelText(/Phone Numbers/i);

  fireEvent.change(baseUrl, { target: { value: 'https://openwa.example.com' } });
  fireEvent.change(apiKey, { target: { value: 'secret-key' } });
  fireEvent.change(sessionId, { target: { value: 'session-1' } });
  fireEvent.change(numbers, { target: { value: '+1234567890, +0987654321' } });
}

describe('IntegrationSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupIntegrationsMock();
    setupUpdateMutationMock();
    showToastMock.mockClear();
    (apiClient.post as Mock).mockResolvedValue({
      data: {
        data: {
          ok: true,
          status: 'ok',
          message: 'Connection verified',
          tested_at: '2026-06-27T11:00:00Z',
        } as TestIntegrationResult,
      },
    });
  });

  it('starts at provider selection when no integration prop is supplied', () => {
    renderWithProviders(
      <IntegrationSetupWizard open={true} onOpenChange={vi.fn()} />,
    );

    expect(screen.getByText('Select a provider to configure')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByText('OpenWA')).toBeInTheDocument();
  });

  it('advances to credentials after selecting a provider', async () => {
    renderWithProviders(
      <IntegrationSetupWizard open={true} onOpenChange={vi.fn()} />,
    );

    const providerButton = screen.getByRole('button', { name: /OpenWA/i });
    providerButton.click();

    await waitFor(() => {
      expect(screen.getByText('Configure OpenWA')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/OpenWA Base URL/i)).toBeInTheDocument();
  });

  it('skips provider selection when integration prop is supplied', () => {
    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    expect(screen.getByText('Configure OpenWA')).toBeInTheDocument();
    expect(screen.queryByText('Select a provider to configure')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/OpenWA Base URL/i)).toBeInTheDocument();
  });

  it('renders OpenWA credential fields including help text', () => {
    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    expect(screen.getByLabelText(/OpenWA Base URL/i)).toBeInTheDocument();
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

  it('disables the Next button until required credentials are filled', () => {
    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    const nextButton = screen.getByRole('button', { name: /next/i });
    expect(nextButton).toBeDisabled();

    fillOpenwaCredentials();

    expect(nextButton).toBeEnabled();
  });

  it('shows success result after a successful connection test', async () => {
    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    fillOpenwaCredentials();

    screen.getByRole('button', { name: /next/i }).click();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /test connection/i }).click();

    await waitFor(() => {
      expect(screen.getByText('Connection successful')).toBeInTheDocument();
      expect(screen.getByText('Connection verified')).toBeInTheDocument();
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      `/integrations/${openwaIntegration.id}/test`,
      {
        credentials: {
          baseUrl: 'https://openwa.example.com',
          apiKey: 'secret-key',
          sessionId: 'session-1',
          numbers: ['+1234567890', '+0987654321'],
        },
      },
    );
  });

  it('shows an error toast when the connection test fails', async () => {
    (apiClient.post as Mock).mockRejectedValue(new Error('Connection refused'));

    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    fillOpenwaCredentials();

    screen.getByRole('button', { name: /next/i }).click();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /test connection/i }).click();

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        'Connection test failed. Please check your credentials and try again.',
        'error',
      );
    });
  });

  it('enables and finishes by calling useUpdateIntegration with the draft credentials', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    setupUpdateMutationMock(mutateAsync);

    renderWithProviders(
      <IntegrationSetupWizard
        open={true}
        onOpenChange={vi.fn()}
        integration={openwaIntegration}
      />,
    );

    fillOpenwaCredentials();

    screen.getByRole('button', { name: /next/i }).click();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /test connection/i }).click();

    await waitFor(() => {
      expect(screen.getByText('Connection successful')).toBeInTheDocument();
    });

    screen.getByRole('button', { name: /next/i }).click();

    await waitFor(() => {
      expect(screen.getByText('Ready to enable')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('switch'));

    screen.getByRole('button', { name: /finish/i }).click();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: openwaIntegration.id,
        input: {
          is_enabled: true,
          credentials: {
            baseUrl: 'https://openwa.example.com',
            apiKey: 'secret-key',
            sessionId: 'session-1',
            numbers: ['+1234567890', '+0987654321'],
          },
        },
      });
    });
  });

  it('calls onOpenChange(false) when the close button is clicked', () => {
    const onOpenChange = vi.fn();

    renderWithProviders(
      <IntegrationSetupWizard open={true} onOpenChange={onOpenChange} />,
    );

    screen.getByRole('button', { name: /close/i }).click();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});
