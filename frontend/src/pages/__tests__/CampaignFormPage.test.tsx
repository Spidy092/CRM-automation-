import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignFormPage } from '../CampaignFormPage';

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

describe('CampaignFormPage (wizard)', () => {
  it('renders the step indicator with all four steps', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1\s*Basics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /2\s*Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\s*Sequence/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\s*Review & Launch/i })).toBeInTheDocument();
  });

  it('starts on Basics and blocks Next until a name is entered', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /Next/i });
    expect(nextButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Campaign Name/i), { target: { value: 'Q3 Push' } });
    expect(nextButton).not.toBeDisabled();
  });

  it('walks through pipeline and sequence steps to review', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Campaign Name/i), { target: { value: 'Q3 Push' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 2: pipeline trigger
    expect(screen.getByText(/Pipeline Auto-Enrollment/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: sequence — warns that launch is blocked without one
    expect(screen.getByText(/Outreach Sequence/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot launch/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: review + readiness check
    expect(screen.getByRole('heading', { name: 'Readiness Check' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save draft & check readiness/i })).toBeInTheDocument();
    // Launch is blocked because no sequence is selected
    expect(screen.getByRole('button', { name: /Save & Launch/i })).toBeDisabled();
  });
});
