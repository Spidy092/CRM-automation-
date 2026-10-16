import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { OperationsOverview } from '../OperationsOverview';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

const makeOperations = (overrides: Record<string, unknown> = {}) => ({
  campaignId: 'camp-1',
  status: 'active',
  timezone: 'UTC',
  durable: true,
  nextActivity: {
    kind: 'committed',
    leadId: 'lead-1',
    businessName: 'Acme Diner',
    stepNumber: 2,
    channel: 'email',
    dueAt: '2026-10-13T12:30:00.000Z',
    dueLabel: 'Oct 13 at 12:30 PM (UTC)',
  },
  scheduledCount: 3,
  potentialRemaining: 9,
  sentToday: 3,
  dailyLimit: 50,
  capacityRemaining: 47,
  attempts: 4,
  failedUnresolved: 0,
  uncertain: 0,
  executionsByState: [{ state: 'scheduled', channel: 'email', count: 3 }],
  waitingReasons: [{ reason: 'sequence_delay', count: 2 }],
  attention: [],
  computedAt: new Date().toISOString(),
  ...overrides,
});

describe('OperationsOverview', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('shows the next activity with its timezone label', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: makeOperations() } });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Next: Step 2 · email/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Oct 13 at 12:30 PM \(UTC\)/)).toBeInTheDocument();
    expect(screen.getByText('Acme Diner')).toBeInTheDocument();
  });

  it('shows scheduled, potential, capacity, and waiting reasons', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: makeOperations() } });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('3 / 50')).toBeInTheDocument();
    });
    expect(screen.getByText('47 capacity left')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the next step delay/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is scheduled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: makeOperations({ nextActivity: null, scheduledCount: 0 }) },
    });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('No scheduled sends')).toBeInTheDocument();
    });
  });

  it('explains a paused campaign in the empty state', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: makeOperations({ nextActivity: null, scheduledCount: 0, status: 'paused' }),
      },
    });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText(/campaign is paused/i)).toBeInTheDocument();
    });
  });

  it('shows attention items for failures', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: makeOperations({
          failedUnresolved: 2,
          attention: [{ kind: 'failed', count: 2, label: 'Failed sends need review' }],
        }),
      },
    });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed sends need review \(2\)/)).toBeInTheDocument();
    });
  });

  it('shows an error state with retry when the request fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('network down'));
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not load scheduling')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows a freshness note once data arrives', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: makeOperations() } });
    renderWithProviders(<OperationsOverview campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Updated /)).toBeInTheDocument();
    });
  });
});
