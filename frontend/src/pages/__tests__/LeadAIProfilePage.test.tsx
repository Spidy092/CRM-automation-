import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { LeadAIProfilePage } from '../LeadAIProfilePage';

const mockUseProfile = vi.fn();
const mockUseDecisions = vi.fn();

vi.mock('@/api/aiIntelligence', () => ({
  useLeadAiProfile: () => mockUseProfile(),
  useLeadDecisions: () => mockUseDecisions(),
}));

const fakeProfile = {
  id: 'p1',
  lead_id: 'lead-1',
  website_quality_score: 60,
  pain_points: ['no online booking'],
  offer_angle: 'WhatsApp booking automation',
  inferred_budget_range: 'medium',
  buying_intent: 'high' as const,
  reachability_score: 80,
  buying_signals: [],
  objection_log: [],
  do_not_say: [],
  preferred_channel: 'whatsapp' as const,
  preferred_time_of_day: null,
  conversation_summary: null,
  ai_notes: 'Promising lead',
  next_best_action: 'send_whatsapp' as const,
  next_best_action_reason: 'High intent',
  next_best_action_confidence: 82,
  enrichment_status: 'done' as const,
  last_enriched_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

describe('LeadAIProfilePage', () => {
  it('renders the profile when loaded', () => {
    mockUseProfile.mockReturnValue({ data: fakeProfile, isLoading: false, error: null });
    mockUseDecisions.mockReturnValue({ data: [] });
    renderWithProviders(<LeadAIProfilePage />);
    expect(document.body.textContent).toContain('Lead AI Profile');
    expect(document.body.textContent).toContain('WhatsApp booking automation');
  });

  it('renders an empty state when there is no profile', () => {
    mockUseProfile.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseDecisions.mockReturnValue({ data: [] });
    renderWithProviders(<LeadAIProfilePage />);
    expect(document.body.textContent).toContain('No AI profile yet');
  });
});
