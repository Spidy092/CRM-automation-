import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { SchedulePanel } from '../SchedulePanel';
import { ActivityFeed } from '../ActivityFeed';
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

describe('SchedulePanel', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') {
        return { data: { success: true, data: { id: 'camp-1', sequence_id: 'seq-1' } } };
      }
      if (url === '/outreach/sequences/seq-1') {
        return {
          data: {
            success: true,
            data: {
              id: 'seq-1',
              name: 'Intro',
              steps: [
                { stepNumber: 1, channel: 'email', delayHours: 0, templateId: 't1' },
                { stepNumber: 2, channel: 'sms', delayHours: 24, templateId: 't2' },
              ],
            },
          },
        };
      }
      return { data: { success: true, data: null } };
    });
  });

  it('separates committed sends from projected future steps', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: {
          committed: [
            {
              leadId: 'lead-1',
              businessName: 'Acme',
              stepNumber: 2,
              channel: 'email',
              state: 'scheduled',
              dueAt: '2026-10-13T12:30:00.000Z',
              dueLabel: 'Oct 13 at 12:30 PM (UTC)',
            },
          ],
          projected: [
            {
              leadId: 'lead-1',
              stepNumber: 3,
              channel: 'sms',
              estimatedDueAt: '2026-10-14T12:30:00.000Z',
              estimatedDueLabel: 'Oct 14 at 12:30 PM (UTC)',
            },
          ],
          meta: { limit: 50 },
        },
      },
    });
    renderWithProviders(<SchedulePanel campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Committed (1)')).toBeInTheDocument();
    });
    expect(screen.getByText('Projected future steps (1)')).toBeInTheDocument();
    expect(screen.getByText(/Estimates only/)).toBeInTheDocument();
  });

  it('renders a readable sequence timeline with explicit delay units', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1/schedule') {
        return {
          data: { success: true, data: { committed: [], projected: [], meta: { limit: 50 } } },
        };
      }
      if (url === '/campaigns/camp-1') {
        return { data: { success: true, data: { id: 'camp-1', sequence_id: 'seq-1' } } };
      }
      if (url === '/outreach/sequences/seq-1') {
        return {
          data: {
            success: true,
            data: {
              id: 'seq-1',
              name: 'Intro',
              steps: [
                { stepNumber: 1, channel: 'email', delayHours: 0, templateId: 't1' },
                { stepNumber: 2, channel: 'sms', delayHours: 24, templateId: 't2' },
              ],
            },
          },
        };
      }
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<SchedulePanel campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Sequence timeline (2 steps)')).toBeInTheDocument();
    });
    expect(screen.getByText(/sends immediately inside the allowed window/)).toBeInTheDocument();
    expect(screen.getByText(/waits 24h after the previous send/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is scheduled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: { committed: [], projected: [], meta: { limit: 50 } } },
    });
    renderWithProviders(<SchedulePanel campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Nothing scheduled')).toBeInTheDocument();
    });
  });

  it('shows an error state with retry', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('down'));
    renderWithProviders(<SchedulePanel campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not load the schedule')).toBeInTheDocument();
    });
  });
});

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('lists operational history chronologically', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [
          { id: 'a1', kind: 'send', leadId: 'lead-1', stepNumber: 1, channel: 'email', status: 'sent', createdAt: '2026-10-13T10:00:00.000Z' },
          { id: 'a2', kind: 'operator', leadId: null, stepNumber: null, channel: null, status: 'campaign.paused', createdAt: '2026-10-13T09:00:00.000Z' },
        ],
        meta: { hasMore: false, nextCursor: null },
      },
    });
    renderWithProviders(<ActivityFeed campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('send')).toBeInTheDocument();
    });
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  it('shows an empty state before any activity', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [], meta: { hasMore: false, nextCursor: null } },
    });
    renderWithProviders(<ActivityFeed campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('No activity yet')).toBeInTheDocument();
    });
  });

  it('shows an error state with retry', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('down'));
    renderWithProviders(<ActivityFeed campaignId="camp-1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not load activity')).toBeInTheDocument();
    });
  });
});
