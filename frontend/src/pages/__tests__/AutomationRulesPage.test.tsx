import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { AutomationRulesPage } from '../AutomationRulesPage';

vi.mock('@/api/campaigns', () => ({
  useCampaigns: vi.fn().mockReturnValue({
    data: [
      {
        id: 'c1',
        name: 'Test Campaign',
        status: 'active',
        target_industries: ['SaaS', 'Fintech'],
        target_countries: ['US', 'UK'],
        target_pipeline_id: 'p1',
        tone: 'professional',
        sequence_id: 's1',
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/api/pipelines', () => ({
  usePipelines: vi.fn().mockReturnValue({
    data: [{ id: 'p1', name: 'Sales Pipeline' }],
    isLoading: false,
    error: null,
  }),
  usePipeline: vi.fn().mockReturnValue({
    data: { id: 'p1', name: 'Sales Pipeline', stages: [] },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/api/outreach', () => ({
  useSequences: vi.fn().mockReturnValue({
    data: [
      {
        id: 's1',
        name: 'Welcome Sequence',
        steps: [
          { step_number: 1, channel: 'email', delay_hours: 0 },
          { step_number: 2, channel: 'whatsapp', delay_hours: 24 },
          { step_number: 3, channel: 'phone_call', delay_hours: 72 },
        ],
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

describe('AutomationRulesPage', () => {
  it('renders successfully', () => {
    const { container } = renderWithProviders(<AutomationRulesPage />);
    expect(container).toBeTruthy();
  });

  it('renders page header', () => {
    renderWithProviders(<AutomationRulesPage />);
    expect(document.body.textContent).toContain('Automation Rules');
  });

  it('renders campaign name', async () => {
    renderWithProviders(<AutomationRulesPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain('Test Campaign');
  });

  it('renders trigger section', () => {
    renderWithProviders(<AutomationRulesPage />);
    expect(document.body.textContent).toContain('Trigger');
  });

  it('renders action section', () => {
    renderWithProviders(<AutomationRulesPage />);
    expect(document.body.textContent).toContain('Action');
  });
});
