import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { AIDecisionLogPage } from '../AIDecisionLogPage';

const mockUseDecisionLog = vi.fn();

vi.mock('@/api/aiDecisions', () => ({
  useDecisionLog: (...args: unknown[]) => mockUseDecisionLog(...args),
}));

const fakeDecision = {
  id: 'd1',
  lead_id: 'lead-1',
  campaign_id: null,
  decision_type: 'research' as const,
  input_context: { lead_id: 'lead-1' },
  chain_of_thought: 'Context → Options → Reasoning → Decision → Confidence',
  decision: 'send_whatsapp',
  confidence: 82,
  tokens_used: 500,
  latency_ms: 1200,
  model_used: 'gpt-4o',
  autonomy_level: 'guarded',
  human_approval_required: false,
  human_approved_by: null,
  human_approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('AIDecisionLogPage', () => {
  it('renders decision entries', () => {
    mockUseDecisionLog.mockReturnValue({ data: { items: [fakeDecision], total: 1 }, isLoading: false, error: null });
    renderWithProviders(<AIDecisionLogPage />);
    expect(document.body.textContent).toContain('AI Decision Log');
    expect(document.body.textContent).toContain('send_whatsapp');
  });

  it('renders an empty state', () => {
    mockUseDecisionLog.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false, error: null });
    renderWithProviders(<AIDecisionLogPage />);
    expect(document.body.textContent).toContain('No decisions logged');
  });
});
