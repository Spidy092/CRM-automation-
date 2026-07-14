import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignDetailPage } from '../CampaignDetailPage';
import { apiClient } from '@/api/client';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'camp-1' }) };
});

vi.mock('@/api/client', () => {
  const campaign = {
    id: 'camp-1',
    name: 'Q3 Restaurant Push',
    status: 'draft',
    tone: 'professional',
    target_industries: ['restaurants'],
    target_countries: ['US'],
    sequence_id: null,
    pipeline_id: null,
    trigger_stage_id: null,
    ai_personalization_enabled: false,
    created_by: 'admin',
    launched_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const genericData = Object.assign([campaign], campaign, {
    total_leads: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    replied: 0,
    failed: 0,
  });

  return {
    apiClient: {
      get: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
    },
  };
});

describe('CampaignDetailPage', () => {
  it('shows automation setup with guidance when nothing is attached', async () => {
    renderWithProviders(<CampaignDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Q3 Restaurant Push')).toBeInTheDocument();
    });

    expect(screen.getByText('Automation Setup')).toBeInTheDocument();
    expect(screen.getByText(/None — leads are only added manually/i)).toBeInTheDocument();
    expect(screen.getByText(/No sequence attached/i)).toBeInTheDocument();
    // Draft campaigns expose launch + edit actions right on the page
    expect(screen.getByRole('button', { name: /Launch/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/i })).toBeInTheDocument();
  });

  it('shows the failure reason and a Retry button for a failed send, and retries it', async () => {
    const campaign = {
      id: 'camp-1',
      name: 'Q3 Restaurant Push',
      status: 'active',
      tone: 'professional',
      target_industries: [],
      target_countries: [],
      sequence_id: null,
      pipeline_id: null,
      trigger_stage_id: null,
      ai_personalization_enabled: false,
      created_by: 'admin',
      launched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
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
});
