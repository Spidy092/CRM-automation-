import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignBriefPage } from '../CampaignBriefPage';

const mockUseBrief = vi.fn();

vi.mock('@/api/aiCampaignBrain', () => ({
  useCampaignBrief: () => mockUseBrief(),
  useApproveBrief: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectBrief: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const fakeBrief = {
  id: 'b1',
  campaign_id: 'c1',
  total_leads_evaluated: 188,
  eligible_leads: 150,
  high_fit_leads: 42,
  segment_summary: '188 local service businesses',
  recommended_offer_angle: 'WhatsApp booking automation',
  expected_objections: ['too expensive'],
  risk_warnings: ['8 may be competitors'],
  recommended_sequence: [],
  template_suggestions: [],
  recommended_autonomy_level: 'guarded' as const,
  confidence_score: 78,
  status: 'draft' as const,
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('CampaignBriefPage', () => {
  it('renders the brief when loaded', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(document.body.textContent).toContain('Campaign Brief');
    expect(document.body.textContent).toContain('188 local service businesses');
  });

  it('renders an empty state when there is no brief', () => {
    mockUseBrief.mockReturnValue({ data: null, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(document.body.textContent).toContain('No brief generated yet');
  });
});
