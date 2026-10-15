import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignsPage } from '../CampaignsPage';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn(),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn(),
  },
}));

const makeCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'camp-1',
  name: 'Q3 Restaurant Push',
  status: 'active',
  tone: 'professional',
  target_industries: ['restaurants'],
  target_countries: ['US'],
  sequence_id: null,
  pipeline_id: null,
  trigger_stage_id: null,
  trigger_source: null,
  trigger_tags: null,
  ai_personalization_enabled: false,
  autonomy_level: 'guarded',
  ai_min_confidence: 0,
  ab_test_enabled: false,
  ab_test_metric: 'open_rate',
  ab_test_min_samples: 100,
  ab_test_confidence: 95,
  ab_test_auto_promote: true,
  send_window_enabled: false,
  send_window_start_hour: 9,
  send_window_end_hour: 18,
  send_window_days: [1, 2, 3, 4, 5],
  send_window_timezone: 'UTC',
  daily_send_limit: null,
  created_by: 'admin',
  launched_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

function mockBackend(campaigns: unknown[], summaries: unknown[] = []) {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/campaigns') return { data: { success: true, data: campaigns } };
    if (url === '/campaigns/operations-summary') {
      return { data: { success: true, data: summaries } };
    }
    return { data: { success: true, data: null } };
  });
}

describe('CampaignsPage operations', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
  });

  it('fetches one bulk summary for all campaigns instead of per-campaign requests', async () => {
    mockBackend(
      [makeCampaign(), makeCampaign({ id: 'camp-2', name: 'Second', status: 'paused' })],
      [
        { campaignId: 'camp-1', scheduled: 2, failed: 1, uncertain: 0, nextDueAt: null },
        { campaignId: 'camp-2', scheduled: 0, failed: 0, uncertain: 0, nextDueAt: null },
      ],
    );
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });
    const summaryCalls = vi
      .mocked(apiClient.get)
      .mock.calls.filter(([url]) => url === '/campaigns/operations-summary');
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0][1]).toMatchObject({ params: expect.objectContaining({ ids: expect.any(String) }) });
    expect(screen.getByText('2 scheduled')).toBeInTheDocument();
  });

  it('filters cards by search text', async () => {
    mockBackend([makeCampaign(), makeCampaign({ id: 'camp-2', name: 'Second', target_industries: ['retail'] })]);
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/search campaigns/i), { target: { value: 'restaurant' } });

    await waitFor(() => {
      expect(screen.queryByText('Second')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
  });

  it('filters by status and attention', async () => {
    mockBackend(
      [makeCampaign(), makeCampaign({ id: 'camp-2', name: 'Second', status: 'paused' })],
      [
        { campaignId: 'camp-1', scheduled: 2, failed: 1, uncertain: 0, nextDueAt: null },
        { campaignId: 'camp-2', scheduled: 0, failed: 0, uncertain: 0, nextDueAt: null },
      ],
    );
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: 'paused' } });
    await waitFor(() => {
      expect(screen.queryByText('Q3 Restaurant Push')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: /needs attention/i }));
    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
      expect(screen.queryByText('Second')).not.toBeInTheDocument();
    });
  });

  it('switches between card and table modes with keyboard-accessible controls', async () => {
    mockBackend([makeCampaign()]);
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });
    const tableButton = screen.getByRole('button', { name: 'Table' });
    tableButton.focus();
    expect(document.activeElement).toBe(tableButton);
    fireEvent.click(tableButton);

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /next send/i })).toBeInTheDocument();
    });
  });

  it('shows an empty state when filters match nothing', async () => {
    mockBackend([makeCampaign()]);
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/search campaigns/i), { target: { value: 'zzz-no-match' } });

    await waitFor(() => {
      expect(screen.getByText('No campaigns match')).toBeInTheDocument();
    });
  });
});
