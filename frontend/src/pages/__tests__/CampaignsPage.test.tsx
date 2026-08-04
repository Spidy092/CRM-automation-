import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignsPage } from '../CampaignsPage';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
  },
}));

const makeCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'camp-1',
  name: 'Q3 Restaurant Push',
  status: 'draft',
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

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });

  it('renders the empty state when no campaigns exist', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText(/No campaigns created yet/i)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('link', { name: /Create Campaign/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('renders campaign cards when campaigns exist', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [
          makeCampaign({ id: 'c1', name: 'Summer Push', status: 'active' }),
          makeCampaign({ id: 'c2', name: 'Winter Push', status: 'draft' }),
        ],
      },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Summer Push')).toBeInTheDocument();
    });
    expect(screen.getByText('Winter Push')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('shows page header metrics', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [
          makeCampaign({ id: 'c1', name: 'Active Campaign', status: 'active' }),
          makeCampaign({ id: 'c2', name: 'Draft Campaign', status: 'draft' }),
          makeCampaign({ id: 'c3', name: 'Paused Campaign', status: 'paused' }),
        ],
      },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Active Campaign')).toBeInTheDocument();
    });
    expect(screen.getByText('3')).toBeInTheDocument(); // total campaigns
  });

  it('shows Launch button for draft campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ status: 'draft' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    });
  });

  it('shows Pause button for active campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ status: 'active' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    });
  });

  it('shows Resume button for paused campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ status: 'paused' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    });
  });

  it('calls pause API when Pause is clicked', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ id: 'c1', status: 'active' })] },
    });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: makeCampaign({ id: 'c1', status: 'paused' }) },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Pause/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/pause');
    });
  });

  it('calls resume API when Resume is clicked', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ id: 'c1', status: 'paused' })] },
    });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: makeCampaign({ id: 'c1', status: 'active' }) },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Resume/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/c1/resume');
    });
  });

  it('shows delete confirmation dialog and calls delete API on confirm', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ id: 'c1', status: 'draft' })] },
    });
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { success: true } });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    // Click delete button (the trash icon button)
    const deleteButtons = screen.getAllByRole('button');
    const trashButton = deleteButtons.find((btn) => btn.querySelector('.text-red-500'));
    expect(trashButton).toBeDefined();
    fireEvent.click(trashButton!);

    // AlertDialog should appear
    await waitFor(() => {
      expect(screen.getByText('Delete campaign')).toBeInTheDocument();
    });
    expect(screen.getByText(/Are you sure you want to delete this campaign/i)).toBeInTheDocument();

    // Click confirm
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/campaigns/c1');
    });
  });

  it('does not call delete API when dialog is cancelled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ id: 'c1', status: 'draft' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button');
    const trashButton = deleteButtons.find((btn) => btn.querySelector('.text-red-500'));
    fireEvent.click(trashButton!);

    await waitFor(() => {
      expect(screen.getByText('Delete campaign')).toBeInTheDocument();
    });

    // Click cancel
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText('Delete campaign')).not.toBeInTheDocument();
    });
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('disables delete button for active campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ id: 'c1', status: 'active' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button');
    const trashButton = deleteButtons.find((btn) => btn.querySelector('.text-red-500'));
    expect(trashButton).toBeDisabled();
  });

  it('opens launch preview modal for draft campaigns', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns') return { data: { success: true, data: [makeCampaign({ id: 'c1', status: 'draft' })] } };
      if (url === '/campaigns/c1/automation-preview') {
        return {
          data: {
            success: true,
            data: {
              campaignId: 'c1',
              sequenceId: null,
              firstStep: null,
              eligibleLeads: [],
              skippedLeads: [],
              templateIssues: [],
              connectorIssues: [],
              expectedJobs: 0,
              mockMode: false,
            },
          },
        };
      }
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));

    await waitFor(() => {
      expect(screen.getByText('Launch Preview')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Eligible')).toBeInTheDocument();
    });
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('closes launch preview modal on Escape key', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns') return { data: { success: true, data: [makeCampaign({ id: 'c1', status: 'draft' })] } };
      if (url === '/campaigns/c1/automation-preview') {
        return {
          data: {
            success: true,
            data: {
              campaignId: 'c1',
              sequenceId: null,
              firstStep: null,
              eligibleLeads: [],
              skippedLeads: [],
              templateIssues: [],
              connectorIssues: [],
              expectedJobs: 0,
              mockMode: false,
            },
          },
        };
      }
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));

    await waitFor(() => {
      expect(screen.getByText('Launch Preview')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Launch Preview')).not.toBeInTheDocument();
    });
  });

  it('shows Edit link for draft and paused campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [
          makeCampaign({ id: 'c1', status: 'draft' }),
          makeCampaign({ id: 'c2', status: 'paused' }),
        ],
      },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Edit/i })).toHaveLength(2);
    });
  });

  it('shows Stats link for all campaigns', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: [makeCampaign({ status: 'active' })] },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Stats/i })).toBeInTheDocument();
    });
  });

  it('shows AI Brief link when AI personalization is enabled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [makeCampaign({ id: 'c1', ai_personalization_enabled: true })],
      },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /AI Brief/i })).toBeInTheDocument();
    });
  });

  it('does not show AI Brief link when AI personalization is disabled', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: [makeCampaign({ id: 'c1', ai_personalization_enabled: false })],
      },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /AI Brief/i })).not.toBeInTheDocument();
  });

  it('shows pagination when there are more than 9 campaigns', async () => {
    const campaigns = Array.from({ length: 12 }, (_, i) =>
      makeCampaign({ id: `c${i}`, name: `Campaign ${i}` }),
    );
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: campaigns },
    });
    renderWithProviders(<CampaignsPage />);

    await waitFor(() => {
      expect(screen.getByText('Campaign 0')).toBeInTheDocument();
    });

    // Should show page info
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    // Should show next button
    expect(screen.getByRole('button', { name: /Next page/i })).toBeInTheDocument();
  });
});
