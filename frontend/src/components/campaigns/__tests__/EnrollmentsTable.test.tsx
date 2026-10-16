import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { EnrollmentsTable } from '../EnrollmentsTable';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

const FUTURE_DUE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  leadId: 'lead-1',
  businessName: 'Acme Diner',
  contactName: 'Sam',
  leadStatus: 'active',
  enrollmentStatus: 'active',
  completedSteps: 1,
  totalSteps: 4,
  nextAction: {
    kind: 'committed',
    stepNumber: 2,
    channel: 'email',
    dueAt: FUTURE_DUE,
    dueLabel: 'Tomorrow at 12:30 PM (UTC)',
  },
  waitingReason: 'sequence_delay',
  waitingDetail: null,
  terminalReason: null,
  lastActivity: { at: '2026-10-12T10:00:00.000Z', status: 'sent' },
  openTasks: 0,
  schedulingGeneration: 3,
  timingUnknown: false,
  actions: { pause: true, resume: false, retry: false, reschedule: false },
  ...overrides,
});

const pageOf = (items: unknown[]) => ({
  data: { success: true, data: items, meta: { hasMore: false, nextCursor: null } },
});

describe('EnrollmentsTable', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockClear();
  });

  it('shows per-lead progress with next action and waiting reason', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(pageOf([makeItem()]));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Acme Diner')).toBeInTheDocument();
    });
    expect(screen.getByText('1/4 steps')).toBeInTheDocument();
    expect(screen.getByText(/Step 2 · email/)).toBeInTheDocument();
    expect(screen.getByText('Tomorrow at 12:30 PM (UTC)')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the next step delay')).toBeInTheDocument();
  });

  it('marks projected next actions as projected', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      pageOf([makeItem({ nextAction: { kind: 'projected', stepNumber: 3, channel: 'sms', dueAt: null, dueLabel: null } })]),
    );
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('(projected)')).toBeInTheDocument();
    });
  });

  it('shows terminal reasons instead of countdowns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(
      pageOf([
        makeItem({
          enrollmentStatus: 'stopped',
          nextAction: null,
          waitingReason: null,
          terminalReason: 'opted_out',
          actions: { pause: false, resume: false, retry: false, reschedule: false },
        }),
      ]),
    );
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('opted_out')).toBeInTheDocument();
    });
  });

  it('pauses a lead with its scheduling generation', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(pageOf([makeItem()]));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pause lead/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /pause lead/i }));

    await waitFor(() => {
      expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
        '/campaigns/camp-1/enrollments/lead-1/pause',
        expect.objectContaining({ expectedGeneration: 3 }),
      );
    });
  });

  it('shows an empty state when no enrollments match', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(pageOf([]));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('No leads enrolled')).toBeInTheDocument();
    });
  });

  it('shows an error state with retry', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('down'));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not load enrollments')).toBeInTheDocument();
    });
  });

  it('exposes search and status filters with accessible labels', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(pageOf([]));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/search enrolled leads/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/filter by enrollment status/i)).toBeInTheDocument();
  });

  it('paginates with server cursors', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({
        data: { success: true, data: [makeItem()], meta: { hasMore: true, nextCursor: 'cursor-1' } },
      })
      .mockResolvedValueOnce(pageOf([makeItem({ leadId: 'lead-2', businessName: 'Bakery' })]));
    renderWithProviders(<EnrollmentsTable campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next enrollments page/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /next enrollments page/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /next enrollments page/i }));

    await waitFor(() => {
      expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith(
        '/campaigns/camp-1/enrollments',
        expect.objectContaining({ params: expect.objectContaining({ cursor: 'cursor-1' }) }),
      );
    });
  });
});
