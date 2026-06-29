import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils';
import { AIInboxPage } from '../AIInboxPage';

const mockUseInbox = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue({});

vi.mock('@/api/aiInbox', () => ({
  useInbox: (...args: unknown[]) => mockUseInbox(...args),
  useActionInboxItem: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const baseFakeItem = {
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
  agent_action_id: null,
  action_result: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

describe('AIInboxPage', () => {
  beforeEach(() => {
    mockMutateAsync.mockClear();
    mockMutateAsync.mockResolvedValue({});
  });

  it('renders inbox items', () => {
    mockUseInbox.mockReturnValue({ data: { items: [baseFakeItem], total: 1 }, isLoading: false, error: null });
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

  it('renders the error state when useInbox returns an error', () => {
    mockUseInbox.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });
    renderWithProviders(<AIInboxPage />);
    expect(screen.getByText('Could not load your inbox')).toBeInTheDocument();
  });

  it('calls mutateAsync with approve when Approve is clicked and shows success toast', async () => {
    const user = userEvent.setup();
    mockUseInbox.mockReturnValue({
      data: { items: [baseFakeItem], total: 1 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'i1',
        action: 'approve',
        snoozed_until: undefined,
      });
    });

    expect(await screen.findByText('Item approved.')).toBeInTheDocument();
  });

  it('calls mutateAsync with reject when Reject is clicked and shows success toast', async () => {
    const user = userEvent.setup();
    mockUseInbox.mockReturnValue({
      data: { items: [baseFakeItem], total: 1 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    await user.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 'i1',
        action: 'reject',
        snoozed_until: undefined,
      });
    });

    expect(await screen.findByText('Item rejected.')).toBeInTheDocument();
  });

  it('calls mutateAsync with snooze and a snoozed_until ~4 hours from now when Snooze is clicked', async () => {
    const user = userEvent.setup();
    mockUseInbox.mockReturnValue({
      data: { items: [baseFakeItem], total: 1 },
      isLoading: false,
      error: null,
    });

    const before = Date.now();
    renderWithProviders(<AIInboxPage />);

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockMutateAsync.mock.calls[0][0] as {
      id: string;
      action: string;
      snoozed_until?: string;
    };
    expect(callArgs.id).toBe('i1');
    expect(callArgs.action).toBe('snooze');
    expect(callArgs.snoozed_until).toBeDefined();

    const snoozedMs = new Date(callArgs.snoozed_until as string).getTime();
    const fourHours = 4 * 60 * 60 * 1000;
    // Allow a few seconds of drift between before/after timestamps
    expect(snoozedMs).toBeGreaterThanOrEqual(before + fourHours - 5_000);
    expect(snoozedMs).toBeLessThanOrEqual(Date.now() + fourHours + 5_000);

    expect(await screen.findByText('Item snoozed for 4h.')).toBeInTheDocument();
  });

  it('sorts items by urgency_score descending (highest first)', () => {
    const lowUrgency = { ...baseFakeItem, id: 'low', title: 'Low urgency item', urgency_score: 20 };
    const highUrgency = { ...baseFakeItem, id: 'high', title: 'High urgency item', urgency_score: 95 };
    mockUseInbox.mockReturnValue({
      data: { items: [lowUrgency, highUrgency], total: 2 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    const highNode = screen.getByText('High urgency item');
    const lowNode = screen.getByText('Low urgency item');
    // DOM order: high should appear before low (lower compareDocumentPosition value)
    expect(highNode.compareDocumentPosition(lowNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders action_result with structured status and message fields (not JSON.stringify)', () => {
    const itemWithResult = {
      ...baseFakeItem,
      action_result: { ok: true, status: 'succeeded', message: 'Sent!' },
    };
    mockUseInbox.mockReturnValue({
      data: { items: [itemWithResult], total: 1 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    expect(screen.getByText('Action result')).toBeInTheDocument();
    expect(screen.getByText(/Status:/)).toBeInTheDocument();
    expect(screen.getByText(/Result:/)).toBeInTheDocument();
    expect(screen.getByText(/succeeded/)).toBeInTheDocument();
    expect(screen.getByText(/Sent!/)).toBeInTheDocument();
  });

  it('renders an "Agent action linked" badge when agent_action_id is set', () => {
    const itemWithAgentAction = { ...baseFakeItem, agent_action_id: 'abc-123' };
    mockUseInbox.mockReturnValue({
      data: { items: [itemWithAgentAction], total: 1 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    expect(screen.getByText('Agent action linked')).toBeInTheDocument();
  });

  it('shows an error toast when mutateAsync rejects', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockRejectedValueOnce(new Error('network down'));
    mockUseInbox.mockReturnValue({
      data: { items: [baseFakeItem], total: 1 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AIInboxPage />);

    await user.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByText('Failed to update inbox item.')).toBeInTheDocument();
  });
});
