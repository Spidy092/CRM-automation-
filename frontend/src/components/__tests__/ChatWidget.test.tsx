import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils';
import { ChatWidget } from '../ChatWidget';

const mockMutateAsync = vi.fn();
const mockRefetch = vi.fn();

vi.mock('@/api/chat', () => ({
  useChatHistory: vi.fn(() => ({
    data: [],
    refetch: mockRefetch,
    isLoading: false,
  })),
  useSendChatMessage: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
    reset: vi.fn(),
  })),
}));

vi.mock('@/api/agentPlans', () => ({
  usePlan: vi.fn(() => ({ data: null, isLoading: false })),
  useApprovePlan: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useCancelPlan: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

const mockActionInboxItemMutate = vi.fn();

vi.mock('@/api/aiInbox', () => ({
  useActionInboxItem: vi.fn(() => ({
    mutate: mockActionInboxItemMutate,
    isPending: false,
    isError: false,
  })),
  useInbox: vi.fn(() => ({
    data: { items: [], total: 0 },
    isLoading: false,
  })),
}));

import { useChatHistory, useSendChatMessage } from '@/api/chat';
import { usePlan, useApprovePlan, useCancelPlan } from '@/api/agentPlans';
import { useActionInboxItem, useInbox } from '@/api/aiInbox';

const useChatHistoryMock = useChatHistory as unknown as ReturnType<typeof vi.fn>;
const useSendChatMessageMock = useSendChatMessage as unknown as ReturnType<typeof vi.fn>;
const usePlanMock = usePlan as unknown as ReturnType<typeof vi.fn>;
const useApprovePlanMock = useApprovePlan as unknown as ReturnType<typeof vi.fn>;
const useCancelPlanMock = useCancelPlan as unknown as ReturnType<typeof vi.fn>;
const useActionInboxItemMock = useActionInboxItem as unknown as ReturnType<typeof vi.fn>;
const useInboxMock = useInbox as unknown as ReturnType<typeof vi.fn>;

describe('ChatWidget', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({
      conversationId: 'conv-1',
      reply: 'Hello from copilot',
    });
    useChatHistoryMock.mockReturnValue({
      data: [],
      refetch: mockRefetch,
      isLoading: false,
    });
    useSendChatMessageMock.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      reset: vi.fn(),
    });
    usePlanMock.mockReturnValue({ data: null, isLoading: false });
    useApprovePlanMock.mockReturnValue({ mutateAsync: vi.fn() });
    useCancelPlanMock.mockReturnValue({ mutateAsync: vi.fn() });
    mockActionInboxItemMutate.mockReset();
    useActionInboxItemMock.mockReturnValue({
      mutate: mockActionInboxItemMutate,
      isPending: false,
      isError: false,
    });
    useInboxMock.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
    });
  });

  it('renders the Open copilot toggle button', () => {
    renderWithProviders(<ChatWidget />);
    expect(screen.getByRole('button', { name: /open copilot/i })).toBeInTheDocument();
  });

  it('opens the widget when the toggle is clicked and shows the input', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatWidget />);

    expect(screen.queryByPlaceholderText(/ask copilot/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    expect(screen.getByPlaceholderText(/ask copilot/i)).toBeInTheDocument();
  });

  it('sends a message with conversationId, message, and pageContext when submitted', async () => {
    const user = userEvent.setup();
    // conversationId is memoized via sessionStorage in the component.
    // Each test gets a fresh module instance, but sessionStorage persists.
    // The component reads "crm-chat-conversation-id" from sessionStorage if set.
    // To keep this test deterministic, just assert the call shape.
    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'Show me hot leads');
    await user.click(screen.getByRole('button', { name: '' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockMutateAsync.mock.calls[0][0] as {
      conversationId: string;
      message: string;
      pageContext: { route: string; availableActions?: string[] };
    };
    expect(callArgs.message).toBe('Show me hot leads');
    expect(callArgs.conversationId).toMatch(/^conv-/);
    expect(callArgs.pageContext.route).toBe('/');
    expect(Array.isArray(callArgs.pageContext.availableActions)).toBe(true);
  });

  it('disables the send button when the message is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const sendButton = screen.getByRole('button', { name: '' });
    expect(sendButton).toBeDisabled();

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'hi');
    expect(sendButton).toBeEnabled();

    await user.clear(input);
    expect(sendButton).toBeDisabled();
  });

  it('shows a Working... indicator while the send mutation is pending', async () => {
    const user = userEvent.setup();
    useSendChatMessageMock.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: true,
      isError: false,
      reset: vi.fn(),
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    expect(screen.getByText(/Working\.\.\./)).toBeInTheDocument();
  });

  it('shows an error card when the send mutation is in error state', async () => {
    const user = userEvent.setup();
    useSendChatMessageMock.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: true,
      reset: vi.fn(),
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    expect(screen.getByText(/Copilot request failed\./)).toBeInTheDocument();
  });

  it('renders in-chat Approve/Reject buttons when the response has require_approval outcome', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'OK, requesting approval',
      action: {
        name: 'lead.pause',
        policy: { outcome: 'require_approval', reason: 'risky' },
        inboxItemId: 'inbox-item-1',
      },
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'pause this lead');
    await user.click(screen.getByRole('button', { name: '' }));

    expect(await screen.findByText(/needs your approval/i)).toBeInTheDocument();
    expect(screen.getAllByText(/lead\.pause/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    expect(screen.queryByText(/AI Inbox/)).not.toBeInTheDocument();
  });

  it('approves the linked inbox item in chat without navigating to the AI Inbox', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'OK, requesting approval',
      action: {
        name: 'scraper.run',
        policy: { outcome: 'require_approval', reason: 'risky' },
        inboxItemId: 'inbox-item-1',
      },
    });
    mockActionInboxItemMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'run my scraper');
    await user.click(screen.getByRole('button', { name: '' }));

    const approveButton = await screen.findByRole('button', { name: /approve/i });
    await user.click(approveButton);

    expect(mockActionInboxItemMutate).toHaveBeenCalledWith(
      { id: 'inbox-item-1', action: 'approve' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(await screen.findByText(/approved and running/i)).toBeInTheDocument();
  });

  it('rejects the linked inbox item in chat', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'OK, requesting approval',
      action: {
        name: 'campaign.launch',
        policy: { outcome: 'require_approval', reason: 'risky' },
        inboxItemId: 'inbox-item-2',
      },
    });
    mockActionInboxItemMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'launch the campaign');
    await user.click(screen.getByRole('button', { name: '' }));

    const rejectButton = await screen.findByRole('button', { name: /reject/i });
    await user.click(rejectButton);

    expect(mockActionInboxItemMutate).toHaveBeenCalledWith(
      { id: 'inbox-item-2', action: 'reject' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(await screen.findByText(/rejected\./i)).toBeInTheDocument();
  });

  it('shows a waiting message when no linked inbox item id is available yet', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'OK, requesting approval',
      action: {
        name: 'lead.pause',
        policy: { outcome: 'require_approval', reason: 'risky' },
        inboxItemId: null,
      },
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'pause this lead');
    await user.click(screen.getByRole('button', { name: '' }));

    expect(await screen.findByText(/appear below as soon as it.s ready to review/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('renders pipe-delimited table rows as readable text instead of raw pipes', async () => {
    const user = userEvent.setup();
    useChatHistoryMock.mockReturnValue({
      data: [
        {
          role: 'assistant',
          content:
            '| Business Name | Rating |\n|---|---|\n| Uday Xerox | 5.0 |',
          createdAt: '2026-07-03T00:00:00Z',
        },
      ],
      refetch: mockRefetch,
      isLoading: false,
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    expect(await screen.findByText(/Business Name · Rating/)).toBeInTheDocument();
    expect(await screen.findByText(/Uday Xerox · 5\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/^\|/)).not.toBeInTheDocument();
  });

  it('renders PlanPreview when the response creates a plan', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'I planned: find hot leads. 2 steps. Approve to run.',
      action: {
        name: 'plan.create',
        policy: { outcome: 'require_approval', reason: 'plan requires approval' },
        result: { planId: 'plan-123', steps: [] },
      },
    });

    usePlanMock.mockReturnValue({
      data: {
        plan: { id: 'plan-123', goal: 'find hot leads', status: 'proposed', autonomy_level: 'supervised', confidence: null, created_at: '' },
        steps: [{ id: 's1', step_index: 0, action_name: 'lead.list', action_args: {}, risk_tier: 'read', depends_on: [], rationale: 'get leads', status: 'pending' }],
        estimatedCostCents: 5,
        requiresApproval: true,
      },
      isLoading: false,
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'find hot leads');
    await user.click(screen.getByRole('button', { name: '' }));

    expect(await screen.findByText(/find hot leads/i)).toBeInTheDocument();
    expect(await screen.findByText(/Approve plan/i)).toBeInTheDocument();
  });

  it('closes the widget when the Close copilot button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatWidget />);

    await user.click(screen.getByRole('button', { name: /open copilot/i }));
    expect(screen.getByPlaceholderText(/ask copilot/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close copilot/i }));
    expect(screen.queryByPlaceholderText(/ask copilot/i)).not.toBeInTheDocument();
  });

  it('builds pageContext with the current route and route-specific availableActions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChatWidget />, { initialEntries: ['/campaigns'] });

    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'launch the summer campaign');
    await user.click(screen.getByRole('button', { name: '' }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockMutateAsync.mock.calls[0][0] as {
      pageContext: { route: string; availableActions: string[] };
    };
    expect(callArgs.pageContext.route).toBe('/campaigns');
    expect(callArgs.pageContext.availableActions).toEqual(
      expect.arrayContaining([
        'campaign.list',
        'campaign.launch',
        'campaign.pause',
        'campaign.resume',
        'campaign.stats',
      ]),
    );
  });
});
