import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { LeadAIProfilePage } from '../LeadAIProfilePage';

const mockUseProfile = vi.fn();
const mockUseDecisions = vi.fn();
const mockUseTriggerResearch = vi.fn();

vi.mock('@/api/aiIntelligence', () => ({
  useLeadAiProfile: () => mockUseProfile(),
  useLeadDecisions: () => mockUseDecisions(),
  useTriggerLeadResearch: () => mockUseTriggerResearch(),
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
  beforeEach(() => {
    mockUseTriggerResearch.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('renders the profile when loaded', () => {
    mockUseProfile.mockReturnValue({ data: fakeProfile, isLoading: false, error: null });
    mockUseDecisions.mockReturnValue({ data: [] });
    renderWithProviders(<LeadAIProfilePage />);
    expect(document.body.textContent).toContain('Lead AI Profile');
    expect(document.body.textContent).toContain('WhatsApp booking automation');
    expect(document.body.textContent).toContain('Re-run research');
  });

  it('renders an empty state when there is no profile', () => {
    mockUseProfile.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseDecisions.mockReturnValue({ data: [] });
    renderWithProviders(<LeadAIProfilePage />);
    expect(document.body.textContent).toContain('No AI profile yet');
    expect(document.body.textContent).toContain('Run AI research');
  });
});
