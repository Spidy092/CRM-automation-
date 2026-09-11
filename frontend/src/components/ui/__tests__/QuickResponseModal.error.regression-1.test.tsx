import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/lib/test-utils';
import { QuickResponseModal } from '../QuickResponseModal';
import { useTemplates } from '@/api/templates';
import { useQuickSend } from '@/api/outreach';
import type { Lead } from '@/types';

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn(),
}));

vi.mock('@/api/outreach', () => ({
  useQuickSend: vi.fn(),
}));

const useTemplatesMock = vi.mocked(useTemplates);
const useQuickSendMock = vi.mocked(useQuickSend);

const lead = {
  id: 'lead-1',
  business_name: 'Acme Inc',
  contact_name: 'Alex Johnson',
  phone: '+15551234567',
  email: '',
} as Lead;

describe('QuickResponseModal error handling regression', () => {
  const mutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTemplatesMock.mockReturnValue({
      data: { items: [], meta: { hasMore: false } },
      isLoading: false,
    } as ReturnType<typeof useTemplates>);
    useQuickSendMock.mockReturnValue({
      mutateAsync,
      isPending: false,
    } as ReturnType<typeof useQuickSend>);
  });

  it('shows the backend error body for a failed custom WhatsApp send', async () => {
    const user = userEvent.setup();
    const providerMessage = 'Quick send failed via whatsapp: Invalid OAuth access token';
    mutateAsync.mockRejectedValueOnce({ response: { data: { error: providerMessage } } });

    renderWithProviders(<QuickResponseModal lead={lead} onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Custom message' }));
    await user.type(screen.getByPlaceholderText('Write a message to this lead...'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send custom message' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(providerMessage);
    });
  });
});
