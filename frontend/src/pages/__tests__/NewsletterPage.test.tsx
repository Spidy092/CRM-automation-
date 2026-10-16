import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterPage } from '../NewsletterPage';
import { useDigestDraft, useBroadcasts, useSubscribers, useSubscriber, useUpdateSubscriberPreferences } from '@/api/newsletter';

const authState = vi.hoisted(() => ({ role: null as string | null }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ accessToken: 'test-token', user: authState.role ? { role: authState.role } : null }),
}));

vi.mock('@/api/newsletter', () => ({
  useSubscribers: vi.fn().mockReturnValue({
    data: { data: [], meta: { limit: 25, offset: 0, total: 0 } },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSubscriberCounts: vi.fn().mockReturnValue({
    data: { pending: 1, confirmed: 5, unsubscribed: 2, total: 8 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSubscriber: vi.fn().mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateSubscriberPreferences: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useBroadcasts: vi.fn().mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDigestStatus: vi.fn().mockReturnValue({
    data: {
      enabled: true,
      schedule: '0 9 * * 5 (Fridays 09:00)',
      timezone: 'UTC',
      nextRunAt: '2026-05-08T09:00:00.000Z',
      autoSend: false,
      lastOutcome: { status: 'needs_review', message: 'Draft ready', at: '2026-05-01T00:00:00.000Z' },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDigestDraft: vi.fn().mockReturnValue({
    data: { draft: null, autoSend: false },
    isLoading: false,
  }),
  useToggleAutomatedDigest: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useRetryBroadcast: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUncertainRecipients: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

vi.mock('@/components/ui/NewsletterBroadcastModal', () => ({
  NewsletterBroadcastModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="broadcast-modal"><button onClick={onClose}>Close modal</button></div>
  ),
}));

vi.mock('@/components/ui/NewsletterDigestConfigModal', () => ({
  NewsletterDigestConfigModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="digest-modal"><button onClick={onClose}>Close modal</button></div>
  ),
}));

vi.mock('@/components/ui/NewsletterContactsModal', () => ({
  NewsletterContactsModal: () => <div data-testid="contacts-modal" />,
}));

describe('NewsletterPage workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.role = null;
  });

  it('renders the Newsletters title, primary action, and backend digest status', () => {
    renderWithProviders(<NewsletterPage />);
    expect(screen.getByText('Newsletters')).toBeDefined();
    expect(screen.getByRole('button', { name: /create newsletter/i })).toBeDefined();
    // Digest status comes from the backend hook, not local state.
    expect(screen.getAllByText('On').length).toBeGreaterThan(0);
    expect(screen.getByText(/Fridays 09:00/)).toBeDefined();
  });

  it('shows the contact enrollment action only to admins and opens its modal', () => {
    authState.role = 'admin';
    renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Add contacts' }));
    expect(screen.getByTestId('contacts-modal')).toBeDefined();
  });

  it('hides the contact enrollment action from marketing users', () => {
    authState.role = 'marketing';
    renderWithProviders(<NewsletterPage />);
    expect(screen.queryByRole('button', { name: 'Add contacts' })).toBeNull();
  });

  it('organizes the workspace into five tabs with keyboard navigation', () => {
    renderWithProviders(<NewsletterPage />);
    const tablist = screen.getByRole('tablist', { name: /newsletter workspace/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Subscribers', 'Drafts', 'Send history', 'AI Digest']);
    fireEvent.click(screen.getByRole('tab', { name: 'Send history' }));
    expect(screen.getByRole('heading', { name: 'Send history' })).toBeDefined();
    // ArrowRight moves focus/selection to the next tab.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Send history' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'AI Digest' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows subscriber tools: search, filters, copy link, export, and empty state', () => {
    renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribers' }));
    expect(screen.getByLabelText(/search by email/i)).toBeDefined();
    expect(screen.getByLabelText(/filter by status/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /copy signup link/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /export/i })).toBeDefined();
    expect(screen.getByText(/no subscribers found/i)).toBeDefined();
  });

  it('lets an admin edit a subscriber topic selection and frequency', async () => {
    const subscriber = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'person@example.com',
      status: 'confirmed' as const,
      topics: ['product_updates', 'promotions', 'company_news'],
      frequency: 'weekly' as const,
      send_limits_available: true,
      last_sent_at: '2026-10-15T00:00:00.000Z',
      next_eligible_at: '2099-10-22T00:00:00.000Z',
      source: 'website',
      confirmed_at: '2026-10-15T00:00:00.000Z',
      unsubscribed_at: null,
      created_at: '2026-10-14T00:00:00.000Z',
      updated_at: '2026-10-14T00:00:00.000Z',
    };
    const savePreferences = vi.fn().mockResolvedValue({ ...subscriber, topics: ['company_news'], frequency: 'monthly' });
    vi.mocked(useSubscribers).mockReturnValue({
      data: { data: [subscriber], meta: { limit: 25, offset: 0, total: 1 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSubscribers>);
    vi.mocked(useSubscriber).mockReturnValue({ data: subscriber, isLoading: false, error: null, refetch: vi.fn() } as ReturnType<typeof useSubscriber>);
    vi.mocked(useUpdateSubscriberPreferences).mockReturnValue({ mutateAsync: savePreferences, isPending: false } as unknown as ReturnType<typeof useUpdateSubscriberPreferences>);
    authState.role = 'admin';

    renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribers' }));
    expect(screen.getByText('Last newsletter sent')).toBeInTheDocument();
    expect(screen.getByText('Next eligible')).toBeInTheDocument();
    expect(screen.getByText(/2099.*IST/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details for person@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit preferences' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Product updates' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Promotions' }));
    fireEvent.change(screen.getByLabelText('Maximum sending frequency'), { target: { value: 'monthly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Subscriber preferences updated.')).toBeDefined();
    expect(savePreferences).toHaveBeenCalledWith({
      id: subscriber.id,
      preferences: { topics: ['company_news'], frequency: 'monthly' },
    });
  });

  it('preserves in-progress edits during a detail refresh and resets when another subscriber is selected', () => {
    const firstSubscriber = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'first@example.com',
      status: 'confirmed' as const,
      topics: ['product_updates', 'promotions'],
      frequency: 'weekly' as const,
      send_limits_available: true,
      last_sent_at: null,
      next_eligible_at: null,
      source: 'website',
      confirmed_at: '2026-10-15T00:00:00.000Z',
      unsubscribed_at: null,
      created_at: '2026-10-14T00:00:00.000Z',
      updated_at: '2026-10-14T00:00:00.000Z',
    };
    const secondSubscriber = {
      ...firstSubscriber,
      id: '650e8400-e29b-41d4-a716-446655440001',
      email: 'second@example.com',
      topics: ['company_news'],
      frequency: 'monthly' as const,
    };
    let detailById = { [firstSubscriber.id]: firstSubscriber, [secondSubscriber.id]: secondSubscriber };
    vi.mocked(useSubscribers).mockReturnValue({
      data: { data: [firstSubscriber, secondSubscriber], meta: { limit: 25, offset: 0, total: 2 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSubscribers>);
    vi.mocked(useSubscriber).mockImplementation((id) => ({
      data: detailById[id],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }) as ReturnType<typeof useSubscriber>);
    authState.role = 'admin';

    const { rerender } = renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Subscribers' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details for first@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit preferences' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Product updates' }));
    fireEvent.change(screen.getByLabelText('Maximum sending frequency'), { target: { value: 'daily' } });

    detailById = {
      ...detailById,
      [firstSubscriber.id]: { ...firstSubscriber, updated_at: '2026-10-16T00:00:00.000Z' },
    };
    rerender(<NewsletterPage />);

    expect(screen.getByRole('button', { name: 'Save preferences' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Product updates' })).not.toBeChecked();
    expect(screen.getByLabelText('Maximum sending frequency')).toHaveValue('daily');

    fireEvent.click(screen.getByRole('button', { name: 'View details for second@example.com' }));
    const subscriberDetails = within(screen.getByRole('dialog', { name: 'Subscriber details' }));
    expect(subscriberDetails.getByRole('button', { name: 'Edit preferences' })).toBeInTheDocument();
    expect(subscriberDetails.getByText('Company news')).toBeInTheDocument();
    expect(subscriberDetails.getByText('monthly')).toBeInTheDocument();
  });

  it('shows uncertain sends with review UI and an explicit opt-in retry', async () => {
    const { useBroadcasts, useUncertainRecipients, useRetryBroadcast } = await import('@/api/newsletter');
    (useBroadcasts as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          id: 'b-1',
          subject: 'October update',
          status: 'partially_failed',
          topics: [],
          frequency: null,
          frequencies: ['daily', 'weekly'],
          timezone: 'UTC',
          attempted: 3,
          accepted: 1,
          failed: 1,
          skipped: 0,
          uncertain: 1,
          uncertainIds: ['sub-u1'],
          failureCount: 1,
          finishedAt: '2026-05-01T00:00:00.000Z',
          delivered: null,
          bounced: null,
          clicked: null,
          unsubscribed: null,
        },
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    (useUncertainRecipients as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{ subscriberId: 'sub-u1', email: 'u1@example.com' }],
      isLoading: false,
    });
    const retryMutate = vi.fn().mockResolvedValue({ enqueued: true, retrying: 1, retryingUncertain: 0 });
    (useRetryBroadcast as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: retryMutate,
      isPending: false,
    });
    renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Send history' }));
    fireEvent.click(screen.getByRole('button', { name: /view newsletter october update/i }));
    // Uncertain state is explicit: count, review list, no auto-resend.
    expect(screen.getByText(/1 recipient\(s\) have an unknown send outcome/i)).toBeDefined();
    expect(screen.getByText('u1@example.com')).toBeDefined();
    // Digest audience shows the enforced frequency list, not "any frequency".
    expect(screen.getByText(/daily \+ weekly/i)).toBeDefined();
    // Retry without opt-in covers failed only.
    fireEvent.click(screen.getByRole('button', { name: /retry failed recipients/i }));
    expect(await screen.findByText(/retry enqueued for 1 failed recipient/i)).toBeDefined();
    expect(retryMutate).toHaveBeenCalledWith({ id: 'b-1', includeUncertain: false });
    // Explicit opt-in includes uncertain with a duplication warning present.
    fireEvent.click(screen.getByLabelText(/include uncertain recipients in the retry/i));
    fireEvent.click(screen.getByRole('button', { name: /retry failed \+ uncertain recipients/i }));
    expect(retryMutate).toHaveBeenLastCalledWith({ id: 'b-1', includeUncertain: true });
  });
  it('does not present an approved draft as awaiting review', () => {
    vi.mocked(useDigestDraft).mockReturnValue({ data: { draft: { subject: 'Approved draft', status: 'approved' }, autoSend: false }, isLoading: false } as ReturnType<typeof useDigestDraft>);
    vi.mocked(useBroadcasts).mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useBroadcasts>);
    renderWithProviders(<NewsletterPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Send history' }));
    expect(screen.queryByText(/AI draft awaiting review/)).toBeNull();
    expect(screen.getByText('No newsletters sent yet')).toBeDefined();
  });

});
