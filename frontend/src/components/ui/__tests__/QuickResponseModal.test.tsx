import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/lib/test-utils';
import { QuickResponseModal } from '../QuickResponseModal';
import { useTemplates } from '@/api/templates';
import { useQuickSend } from '@/api/outreach';
import type { Lead, Template } from '@/types';

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
  email: 'alex@acme.example',
  website: null,
  industry: 'Technology',
  location: 'Bengaluru',
  country: 'India',
  google_rating: null,
  review_count: null,
  social_links: null,
  source_platform: 'manual',
  lead_score: 75,
  classification: 'hot',
  status: 'active',
  assigned_to: null,
  pipeline_stage_id: null,
  custom_fields: {},
  tags: [],
  notes: null,
  deal_value: null,
  won_at: null,
  lost_at: null,
  next_follow_up_at: null,
  created_at: '2026-09-10T00:00:00.000Z',
  updated_at: '2026-09-10T00:00:00.000Z',
} satisfies Lead;

const approvedTemplate = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Welcome email',
  channel: 'email',
  subject: 'Hello {{first_name}}',
  body: 'Welcome to our service, {{first_name}}.',
  variables: ['first_name'],
  attachments: [],
  approval_status: 'approved',
  approved_by: 'user-1',
  approved_at: '2026-09-10T00:00:00.000Z',
  rejection_reason: null,
  created_by: 'user-1',
  created_at: '2026-09-10T00:00:00.000Z',
  updated_at: '2026-09-10T00:00:00.000Z',
} satisfies Template;

describe('QuickResponseModal', () => {
  const mutateAsync = vi.fn().mockResolvedValue({ id: 'log-1' });

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

  it('lets a user compose and send a custom email when no approved template exists', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    renderWithProviders(<QuickResponseModal lead={lead} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Email' }));
    await user.click(screen.getByRole('button', { name: 'Write custom message' }));
    await user.type(screen.getByPlaceholderText('Enter an email subject'), 'A note for Alex');
    await user.type(screen.getByPlaceholderText('Write a message to this lead...'), 'Hi Alex,\nThanks for your time.');
    await user.click(screen.getByRole('button', { name: 'Send custom message' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        leadId: 'lead-1',
        channel: 'email',
        subject: 'A note for Alex',
        body: 'Hi Alex,\nThanks for your time.',
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('requires an email subject before a custom email can be sent', async () => {
    const user = userEvent.setup();

    renderWithProviders(<QuickResponseModal lead={lead} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email' }));
    await user.click(screen.getByRole('tab', { name: 'Custom message' }));
    await user.type(screen.getByPlaceholderText('Write a message to this lead...'), 'Hello there');

    expect(screen.getByRole('button', { name: 'Send custom message' })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the approved-template review and send path available', async () => {
    const user = userEvent.setup();
    useTemplatesMock.mockReturnValue({
      data: { items: [approvedTemplate], meta: { hasMore: false } },
      isLoading: false,
    } as ReturnType<typeof useTemplates>);

    renderWithProviders(<QuickResponseModal lead={lead} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Email' }));
    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByText('Previewing personalized text with lead details.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        leadId: 'lead-1',
        channel: 'email',
        templateId: approvedTemplate.id,
      });
    });
  });
});
