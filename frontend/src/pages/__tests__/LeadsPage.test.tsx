import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { LeadsPage } from '../LeadsPage';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/store/authStore';

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
      get: vi.fn().mockImplementation(async (url) => ({ data: { success: true, data: url === '/leads/tags' ? [] : genericData } })),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: genericData } })
    }
  };
});

describe('LeadsPage', () => {
  beforeEach(() => {
    useAuthStore.getState().setUser({ id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin' });
  });
  it('adds one tag to the selected page using append mode and keeps the selection', async () => {
    const generic = await apiClient.get('/leads');
    const fixture = generic.data.data[0];
    vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/leads'
      ? { data: { success: true, data: [
          { ...fixture, id: 'lead-1', business_name: 'School One', contact_name: 'Principal', industry: 'Education', status: 'active', lead_score: 20, tags: ['vip'] },
          { ...fixture, id: 'lead-2', business_name: 'School Two', contact_name: 'Principal', industry: 'Education', status: 'active', lead_score: 30, tags: [] },
        ], meta: { total: 20, limit: 25, hasMore: false } } }
      : url === '/leads/tags' ? { data: { success: true, data: [] } } : generic);
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { updated: 2 } } });
    renderWithProviders(<LeadsPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Add tag' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tag name'), { target: { value: ' school ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/leads/bulk-update', {
      ids: ['lead-1', 'lead-2'], patch: { tags: ['school'] }, tag_mode: 'append',
    }));
    await waitFor(() => expect(screen.getByLabelText('Tag name')).toHaveValue(''));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('filters leads by a selected existing tag', async () => {
    const generic = await apiClient.get('/leads');
    vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/leads/tags'
      ? { data: { success: true, data: ['website-redesign'] } }
      : generic);
    renderWithProviders(<LeadsPage />);
    await screen.findByRole('option', { name: 'website-redesign' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by tag' }), { target: { value: 'website-redesign' } });
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/leads', expect.objectContaining({
      params: expect.any(URLSearchParams),
    })));
    await waitFor(() => {
      const calls = vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/leads');
      const config = calls[calls.length - 1][1];
      expect(config?.params.get('exact_tag')).toBe('website-redesign');
    });
  });

  it('preserves literal comma tags while combining them with the Contacted tab', async () => {
    const generic = await apiClient.get('/leads');
    vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/leads/tags'
      ? { data: { success: true, data: ['Schools, Bengaluru'] } }
      : generic);
    renderWithProviders(<LeadsPage />, { initialEntries: ['/leads?tab=contacted'] });
    await screen.findByRole('option', { name: 'Schools, Bengaluru' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by tag' }), { target: { value: 'Schools, Bengaluru' } });
    await waitFor(() => {
      const calls = vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/leads');
      const config = calls[calls.length - 1][1];
      expect(config?.params.get('exact_tag')).toBe('Schools, Bengaluru');
      expect(config?.params.get('tags')).toBe('contacted');
    });
  });

  it('renders successfully', async () => {
    const { container } = renderWithProviders(<LeadsPage />);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(container).toBeTruthy();
  });

  it('clears selected leads when moving to another page', async () => {
    const generic = await apiClient.get('/leads');
    const fixture = generic.data.data[0];
    vi.mocked(apiClient.get).mockImplementation(async (url) => url === '/leads'
      ? { data: { success: true, data: [
          { ...fixture, id: 'lead-1', business_name: 'School One', status: 'active', tags: [] },
        ], meta: { total: 50, limit: 25, hasMore: true } } }
      : url === '/leads/tags' ? { data: { success: true, data: [] } } : generic);
    renderWithProviders(<LeadsPage />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument());
  });
});
