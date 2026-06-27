import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { AIInboxPage } from '../AIInboxPage';

const mockUseInbox = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/api/aiInbox', () => ({
  useInbox: (...args: unknown[]) => mockUseInbox(...args),
  useActionInboxItem: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const fakeItem = {
  id: 'i1',
  assigned_to: 'u1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'approve_response' as const,
  title: 'Review AI draft for ABC Dental',
  summary: 'Confidence below threshold',
  urgency_score: 82,
  ai_draft_response: 'Hi there!',
  ai_draft_confidence: 70,
  expires_at: null,
  status: 'pending' as const,
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

describe('AIInboxPage', () => {
  it('renders inbox items', () => {
    mockUseInbox.mockReturnValue({ data: { items: [fakeItem], total: 1 }, isLoading: false, error: null });
    renderWithProviders(<AIInboxPage />);
    expect(document.body.textContent).toContain('AI Inbox');
    expect(document.body.textContent).toContain('Review AI draft for ABC Dental');
  });

  it('renders an empty state when there are no items', () => {
    mockUseInbox.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false, error: null });
    renderWithProviders(<AIInboxPage />);
    expect(document.body.textContent).toContain('Inbox zero');
  });

  it('renders a loading state', () => {
    mockUseInbox.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = renderWithProviders(<AIInboxPage />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });
});
