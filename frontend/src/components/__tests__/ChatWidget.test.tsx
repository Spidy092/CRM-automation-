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

import { useChatHistory, useSendChatMessage } from '@/api/chat';

const useChatHistoryMock = useChatHistory as unknown as ReturnType<typeof vi.fn>;
const useSendChatMessageMock = useSendChatMessage as unknown as ReturnType<typeof vi.fn>;

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

  it('renders an Approval created card when the response has require_approval outcome', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValueOnce({
      conversationId: 'conv-1',
      reply: 'OK, requesting approval',
      action: {
        name: 'lead.pause',
        policy: { outcome: 'require_approval', reason: 'risky' },
      },
    });

    renderWithProviders(<ChatWidget />);
    await user.click(screen.getByRole('button', { name: /open copilot/i }));

    const input = screen.getByPlaceholderText(/ask copilot/i);
    await user.type(input, 'pause this lead');
    await user.click(screen.getByRole('button', { name: '' }));

    expect(await screen.findByText('Approval created')).toBeInTheDocument();
    expect(await screen.findByText(/lead\.pause is waiting in AI Inbox\./)).toBeInTheDocument();
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
