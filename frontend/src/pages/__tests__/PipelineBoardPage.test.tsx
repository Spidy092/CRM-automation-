import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { PipelineBoardPage } from '../PipelineBoardPage';

const pipeline = {
  id: 'pipe-1',
  name: 'Sales Pipeline',
  is_default: true,
  stages: [
    { id: 'stage-1', pipeline_id: 'pipe-1', name: 'New', position: 1, is_terminal_won: false, is_terminal_lost: false },
    { id: 'stage-2', pipeline_id: 'pipe-1', name: 'Qualified', position: 2, is_terminal_won: false, is_terminal_lost: false },
  ],
};

vi.mock('@/api/client', () => {
  const campaigns = [
    {
      id: 'camp-1',
      name: 'Q3 Outreach',
      status: 'active',
      tone: 'professional',
      target_industries: [],
      target_countries: [],
      sequence_id: 'seq-1',
      pipeline_id: 'pipe-1',
      trigger_stage_id: 'stage-2',
      ai_personalization_enabled: false,
      created_by: 'admin',
      launched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  return {
    apiClient: {
      get: vi.fn().mockImplementation(async (url: string) => {
        if (url === '/pipelines') return { data: { success: true, data: [pipeline] } };
        if (url === '/pipelines/pipe-1') return { data: { success: true, data: pipeline } };
        if (url === '/campaigns') return { data: { success: true, data: campaigns } };
        if (url === '/leads') return { data: { success: true, data: [], meta: { limit: 500, hasMore: false } } };
        return { data: { success: true, data: null } };
      }),
      post: vi.fn().mockResolvedValue({ data: { success: true, data: null } }),
      put: vi.fn().mockResolvedValue({ data: { success: true, data: null } }),
      delete: vi.fn().mockResolvedValue({ data: { success: true } }),
      patch: vi.fn().mockResolvedValue({ data: { success: true, data: null } }),
    },
  };
});

describe('PipelineBoardPage', () => {
  it('shows a campaign badge on the stage it triggers on', async () => {
    renderWithProviders(<PipelineBoardPage />);

    await waitFor(() => {
      expect(screen.getByText('Qualified')).toBeInTheDocument();
    });

    const badge = await screen.findByText('Q3 Outreach');
    expect(badge).toBeInTheDocument();

    // The badge should not appear under the "New" stage — the campaign is
    // scoped to a precise trigger_stage_id, not a pipeline-wide catch-all.
    const newColumn = screen.getByText('New').closest('div.flex.w-80');
    expect(newColumn?.textContent).not.toContain('Q3 Outreach');
  });
});
