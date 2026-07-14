import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { ReportsPage } from '../ReportsPage';

vi.mock('@/api/client', () => {
  const dashboardData = {
    totalLeads: 10,
    qualifiedLeads: 5,
    activeOutreach: 3,
    pipelineConversion: 12.5,
    activeCampaigns: 2,
    healthyIntegrations: 4,
    recentActivity: [
      { date: '2023-01-01', leads: 5, outreach: 10 },
      { date: '2023-01-02', leads: 6, outreach: 12 },
    ],
  };

  const meta = { limit: 50, hasMore: false, total: 1 };

  const leadGenData = [{ date: '2023-01-01', source: 'Google', count: 5 }];
  const outreachData = [
    { date: '2023-01-01', channel: 'email', sent: 10, delivered: 8, opened: 4, replied: 2, failed: 1 },
  ];
  const pipelineData = [{ stageName: 'Contacted', leadCount: 5, conversionRate: 25, avgDays: 2.5 }];
  const repsData = [
    { repName: 'Alice', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 1.2 },
  ];
  const campaignsData = [
    { date: '2023-01-01', campaignName: 'Summer Sale', channel: 'email', leadsTargeted: 100, leadsConverted: 10, conversionRate: 0.1 },
  ];
  const integrationsData = [
    {
      name: 'twilio',
      displayName: 'Twilio',
      channel: 'sms',
      status: 'healthy',
      enabled: true,
      successRate: 98.5,
      lastTestedAt: new Date().toISOString(),
    },
  ];

  const genericData = Object.assign(
    [
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
        rules: [],
      },
    ],
    {
      items: [],
      meta: { limit: 10, hasMore: false, total: 0 },
      recentActivity: dashboardData.recentActivity,
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
        avgScore: 85,
      },
      rules: [],
      users: [],
      pipelines: [],
      fields: [],
      stages: [],
      assignments: [],
      logs: [],
      content: '',
    },
  );

  return {
    apiClient: {
      get: vi.fn().mockImplementation((url: string) => {
        const response = (data: unknown) => Promise.resolve({ data: { success: true, data, meta } });

        if (url === '/reports/dashboard') {
          return Promise.resolve({ data: { success: true, data: dashboardData } });
        }
        if (url === '/reports/leads') return response(leadGenData);
        if (url === '/reports/outreach') return response(outreachData);
        if (url === '/reports/pipeline') return response(pipelineData);
        if (url === '/reports/reps') return response(repsData);
        if (url === '/reports/campaigns') return response(campaignsData);
        if (url === '/reports/integrations') return response(integrationsData);

        return Promise.resolve({ data: { success: true, data: genericData } });
      }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
    },
  };
});

describe('ReportsPage', () => {
  it('renders successfully', async () => {
    const { container } = renderWithProviders(<ReportsPage />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeTruthy();
  });

  it('renders all six analytics tabs', async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lead Generation' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Outreach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales Reps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Campaigns' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Integrations' })).toBeInTheDocument();
  });

  it('renders the default lead generation chart', async () => {
    renderWithProviders(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('Leads by Date')).toBeInTheDocument());
  });

  it('renders the campaign chart when the campaigns tab is clicked', async () => {
    renderWithProviders(<ReportsPage />);
    const campaignsTab = await waitFor(() => screen.getByRole('button', { name: 'Campaigns' }));
    await act(async () => {
      fireEvent.click(campaignsTab);
    });
    await waitFor(() => expect(screen.getByText('Leads Targeted')).toBeInTheDocument());
  });

  it('renders the integration status pie when the integrations tab is clicked', async () => {
    renderWithProviders(<ReportsPage />);
    const integrationsTab = await waitFor(() => screen.getByRole('button', { name: 'Integrations' }));
    await act(async () => {
      fireEvent.click(integrationsTab);
    });
    await waitFor(() => expect(screen.getByText('Status Overview')).toBeInTheDocument());
  });
});
