import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { apiClient } from '@/api/client';
import { Route, Routes } from 'react-router-dom';
import { LeadFormPage } from '../LeadFormPage';

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

describe('LeadFormPage', () => {
  it('submits optional additional emails and phones for a lead', async () => {
    renderWithProviders(<LeadFormPage />);

    fireEvent.change(screen.getByLabelText(/Business Name/), { target: { value: 'Acme School' } });
    fireEvent.change(screen.getByLabelText(/Contact Name/), { target: { value: 'Taylor' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'taylor@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByLabelText(/^Industry/), { target: { value: 'Education' } });
    fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Bengaluru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
    fireEvent.change(screen.getByLabelText('Additional email 1'), { target: { value: 'second@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add phone' }));
    fireEvent.change(screen.getByLabelText('Additional phone 1'), { target: { value: '0987654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lead created successfully.');
    expect(apiClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        additional_emails: ['second@example.com'],
        additional_phones: ['0987654321'],
      }),
    );
  });

  it('renders successfully', async () => {
    const { container } = renderWithProviders(<LeadFormPage />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container).toBeTruthy();
  });

  it('shows the server error and keeps entered values when lead creation fails', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { data: { error: 'A lead with this email already exists.' } },
    });
    renderWithProviders(<LeadFormPage />);

    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: 'Acme School' },
    });
    fireEvent.change(screen.getByLabelText(/Contact Name/), {
      target: { value: 'Taylor' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'taylor@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Phone/), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/^Industry/), {
      target: { value: 'Education' },
    });
    fireEvent.change(screen.getByLabelText(/^Location/), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A lead with this email already exists.',
    );
    expect(screen.getByLabelText(/Business Name/)).toHaveValue('Acme School');
    expect(screen.getByLabelText(/Contact Name/)).toHaveValue('Taylor');
    expect(screen.getByLabelText(/^Email/)).toHaveValue('taylor@example.com');
    expect(screen.getByLabelText(/^Phone/)).toHaveValue('1');

    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: 'Acme School Updated' },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Business Name/)).toHaveValue('Acme School Updated');

    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lead created successfully.');
  });

  it('shows a useful fallback message when the server does not return an error', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Network unavailable'));
    renderWithProviders(<LeadFormPage />);

    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: 'Acme School' },
    });
    fireEvent.change(screen.getByLabelText(/Contact Name/), {
      target: { value: 'Taylor' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'taylor@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Phone/), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/^Industry/), {
      target: { value: 'Education' },
    });
    fireEvent.change(screen.getByLabelText(/^Location/), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByLabelText(/Business Name/)).toHaveValue('Acme School');
  });

  it('shows success feedback after a lead is created', async () => {
    renderWithProviders(<LeadFormPage />);

    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: 'Acme School' },
    });
    fireEvent.change(screen.getByLabelText(/Contact Name/), {
      target: { value: 'Taylor' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'taylor@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Phone/), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/^Industry/), {
      target: { value: 'Education' },
    });
    fireEvent.change(screen.getByLabelText(/^Location/), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lead created successfully.');
  });

  it('shows a generic fallback when a failed request has no message', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(undefined);
    renderWithProviders(<LeadFormPage />);

    fireEvent.change(screen.getByLabelText(/Business Name/), {
      target: { value: 'Acme School' },
    });
    fireEvent.change(screen.getByLabelText(/Contact Name/), {
      target: { value: 'Taylor' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'taylor@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Phone/), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/^Industry/), {
      target: { value: 'Education' },
    });
    fireEvent.change(screen.getByLabelText(/^Location/), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create this lead. Your entries are still here; please try again.',
    );
    expect(screen.getByLabelText(/Business Name/)).toHaveValue('Acme School');
  });

  it('shows update errors and preserves the edited values', async () => {
    const lead = {
      id: 'lead-1',
      business_name: 'Existing School',
      contact_name: 'Riley',
      phone: '1',
      email: 'riley@example.com',
      website: null,
      industry: 'Education',
      location: 'Bengaluru',
      country: null,
      google_rating: null,
      review_count: null,
      source_platform: 'manual',
      pipeline_stage_id: null,
      tags: [],
      notes: null,
      deal_value: null,
      next_follow_up_at: null,
      custom_fields: {},
      status: 'active',
    };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => ({
      data: { success: true, data: url === '/leads/lead-1' ? lead : [] },
    }) as never);
    vi.mocked(apiClient.put).mockRejectedValueOnce({
      response: { data: { error: 'This lead could not be updated.' } },
    });

    renderWithProviders(
      <Routes>
        <Route path="/leads/:id/edit" element={<LeadFormPage />} />
      </Routes>,
      { initialEntries: ['/leads/lead-1/edit'] },
    );

    fireEvent.change(await screen.findByLabelText(/Contact Name/), {
      target: { value: 'Riley Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update Lead' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This lead could not be updated.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Lead could not be updated');
    expect(screen.getByLabelText(/Contact Name/)).toHaveValue('Riley Updated');
  });
});
