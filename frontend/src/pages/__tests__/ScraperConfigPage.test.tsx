import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '@/store/authStore';
import { renderWithProviders, screen, fireEvent } from '@/lib/test-utils';
import { ScraperConfigPage } from '../ScraperConfigPage';

vi.mock('@/api/client', () => {
  const genericData = Object.assign([
    {
      id: '1',
      name: 'Test',
      source_type: 'google_places',
      config: {},
      status: 'active',
      role: 'admin',
      created_at: new Date().toISOString(),
      email: 'test@test.com',
      stages: [],
      score: 100,
      lead_id: '1',
      score_value: 100,
      content: 'test',
      type: 'test',
      is_default: true,
      last_name: 'Test',
      first_name: 'Test',
      campaign_id: '1',
      user_id: '1',
      position: 1,
      is_active: true,
      target_industries: [],
      tags: [],
      custom_fields: {},
      rules: []
    }
  ], {
    items: [],
    meta: { limit: 10, hasMore: false, total: 0 },
    recentActivity: [{ date: '2023-01-01', leads: 5, outreach: 10 }, { date: '2023-01-02', leads: 6, outreach: 12 }],
    leadSources: [{ name: 'Test', value: 10 }],
    myPipelineStages: [{ name: 'Test', count: 5 }],
    pipelineConversion: 50,
    totalLeads: 100,
    qualifiedLeads: 20,
    totalCampaigns: 5,
    activeOutreach: 10,
    campaigns: [],
    metrics: {
      activeOutreach: 10,
      totalLeads: 100,
      conversionRate: 20,
      revenue: 50000,
      avgScore: 85
    },
    rules: [],
    users: [],
    pipelines: [],
    fields: [],
    stages: [],
    assignments: [],
    logs: [],
    content: ""
  });

  return {
    apiClient: {
      get: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } })
    }
  };
});

describe('ScraperConfigPage', () => {
  beforeEach(() => useAuthStore.setState({ user: { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'admin' } }));
  it('enables the agent for new Google sources and allows switching to standard mode', async () => {
    renderWithProviders(<ScraperConfigPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    const agentToggle = screen.getByRole('checkbox', { name: 'AI research agent' });
    expect(agentToggle).toBeChecked();
    expect(screen.getByLabelText('Research goal')).toBeInTheDocument();
    expect(screen.getByLabelText('Max AI rounds')).toHaveValue(12);
    expect(screen.getByLabelText('Max external requests')).toHaveValue(80);
    fireEvent.click(agentToggle);
    expect(screen.queryByLabelText('Research goal')).not.toBeInTheDocument();
  });

  it('allows a pinned YouTube channel without a search query and defaults it to review', async () => {
    renderWithProviders(<ScraperConfigPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Source' }));
    fireEvent.click(screen.getByRole('button', { name: 'YouTube' }));
    fireEvent.change(screen.getByPlaceholderText('My Google Places Scraper'), { target: { value: 'Pinned channel' } });
    fireEvent.change(screen.getByPlaceholderText('UC...'), {
      target: { value: 'UC1234567890123456789012' },
    });

    expect(screen.getByLabelText('Import mode')).toHaveValue('review');
    fireEvent.click(screen.getByRole('button', { name: 'Create Source' }));

    expect(await screen.findByRole('button', { name: 'Add Source' })).toBeInTheDocument();
    expect(screen.queryByText('Search query or channel ID is required')).not.toBeInTheDocument();
  });

  it('renders successfully', async () => {
    const { container } = renderWithProviders(<ScraperConfigPage />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container).toBeTruthy();
  });
});
