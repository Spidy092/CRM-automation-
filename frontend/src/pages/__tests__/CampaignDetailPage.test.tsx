import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignDetailPage } from '../CampaignDetailPage';
import { apiClient } from '@/api/client';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'camp-1' }) };
});

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
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

const makeStats = (overrides: Record<string, number> = {}) => ({
  total_leads: 10,
  sent: 8,
  delivered: 7,
  opened: 5,
  replied: 2,
  failed: 1,
  ...overrides,
});

const makeStepStats = () => [
  { step_number: 1, attempts: 10, sent: 8, delivered: 7, opened: 5, replied: 2, failed: 1 },
  { step_number: 2, attempts: 5, sent: 4, delivered: 4, opened: 3, replied: 1, failed: 0 },
];

const makeCampaignLeads = () => [
  {
    lead_id: 'lead-1',
    business_name: 'Acme Diner',
    contact_name: 'John',
    lead_status: 'active',
    latest_step: 1,
    step_status: 'delivered',
    step_time: '2026-07-01T10:00:00Z',
    step_error: null,
  },
  {
    lead_id: 'lead-2',
    business_name: 'Best Bakery',
    contact_name: null,
    lead_status: 'active',
    latest_step: 2,
    step_status: 'replied',
    step_time: '2026-07-02T12:00:00Z',
    step_error: null,
  },
];

describe('CampaignDetailPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  it('shows automation setup with guidance when nothing is attached', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign() } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    expect(screen.getByText('Automation Setup')).toBeInTheDocument();
    expect(screen.getByText(/None — leads are only added manually/i)).toBeInTheDocument();
    expect(screen.getByText(/No sequence attached/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/i })).toBeInTheDocument();
  });

  it('shows performance metrics when stats are available', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign() } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Performance Metrics')).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument(); // total_leads
    expect(screen.getByText('8')).toBeInTheDocument(); // sent
    expect(screen.getByText('7')).toBeInTheDocument(); // delivered
    expect(screen.getByText('5')).toBeInTheDocument(); // opened
    expect(screen.getByText('2')).toBeInTheDocument(); // replied
    expect(screen.getByText('1')).toBeInTheDocument(); // failed
  });

  it('shows open/reply rates as percentages', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign() } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('71% of delivered')).toBeInTheDocument(); // 5/7 = 71%
    });
    expect(screen.getByText('29% of delivered')).toBeInTheDocument(); // 2/7 = 29%
  });

  it('shows sequence funnel table when step stats are available', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign() } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: makeStepStats() } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Sequence Funnel')).toBeInTheDocument();
    });

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('shows enrolled leads table with lead names and statuses', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign() } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: makeCampaignLeads() } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Acme Diner')).toBeInTheDocument();
    });
    expect(screen.getByText('Best Bakery')).toBeInTheDocument();
    expect(screen.getByText('delivered')).toBeInTheDocument();
    expect(screen.getByText('replied')).toBeInTheDocument();
  });

  it('shows status-based button visibility for draft campaigns', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({ status: 'draft' }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause/i })).not.toBeInTheDocument();
  });

  it('shows Pause button for active campaigns', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({ status: 'active', launched_at: new Date().toISOString() }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Launch/i })).not.toBeInTheDocument();
  });

  it('shows Resume + Edit for paused campaigns', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({ status: 'paused' }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Launch/i })).not.toBeInTheDocument();
  });

  it('calls launch API when Launch is clicked', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({ status: 'draft' }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: makeCampaign({ status: 'active' }) },
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Launch/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/camp-1/launch');
    });
  });

  it('shows the failure reason and a Retry button for a failed send, and retries it', async () => {
    const campaign = makeCampaign({ status: 'active', launched_at: new Date().toISOString() });
    const failedLead = {
      lead_id: 'lead-1',
      business_name: 'Acme Diner',
      contact_name: null,
      lead_status: 'active',
      latest_step: 1,
      step_status: 'failed',
      step_time: new Date().toISOString(),
      step_error: 'SendGrid credentials not set',
    };

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: campaign } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [failedLead] } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { enqueued: true } } });

    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('SendGrid credentials not set')).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/campaigns/camp-1/leads/lead-1/retry');
    });
  });

  it('shows send window and daily limit when configured', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({
        send_window_enabled: true,
        send_window_start_hour: 9,
        send_window_end_hour: 17,
        send_window_timezone: 'America/New_York',
        daily_send_limit: 50,
      }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    expect(screen.getByText(/09:00–17:00/)).toBeInTheDocument();
    expect(screen.getByText(/max 50\/day/)).toBeInTheDocument();
  });

  it('shows AI Brief link when AI personalization is enabled', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/campaigns/camp-1') return { data: { success: true, data: makeCampaign({ ai_personalization_enabled: true }) } };
      if (url === '/campaigns/camp-1/stats') return { data: { success: true, data: makeStats() } };
      if (url === '/campaigns/camp-1/stats/steps') return { data: { success: true, data: [] } };
      if (url === '/campaigns/camp-1/leads') return { data: { success: true, data: [] } };
      return { data: { success: true, data: null } };
    });
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /AI Brief/i })).toBeInTheDocument();
    });
  });

  it('shows campaign not found when API returns error', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Not found'));
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText(/Campaign not found/i)).toBeInTheDocument();
    });
  });
});
