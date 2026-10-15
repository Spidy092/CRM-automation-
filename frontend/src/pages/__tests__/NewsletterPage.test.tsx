import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterPage } from '../NewsletterPage';
import { useDigestDraft, useBroadcasts } from '@/api/newsletter';

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

  it('organizes the workspace into four tabs with keyboard navigation', () => {
    renderWithProviders(<NewsletterPage />);
    const tablist = screen.getByRole('tablist', { name: /newsletter workspace/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Subscribers', 'Broadcasts', 'AI Digest']);
    fireEvent.click(screen.getByRole('tab', { name: 'Broadcasts' }));
    expect(screen.getByText(/broadcast history/i)).toBeDefined();
    // ArrowRight moves focus/selection to the next tab.
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Broadcasts' }), { key: 'ArrowRight' });
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
    fireEvent.click(screen.getByRole('tab', { name: 'Broadcasts' }));
    fireEvent.click(screen.getByRole('button', { name: /view broadcast october update/i }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Broadcasts' }));
    expect(screen.queryByText(/AI draft awaiting review/)).toBeNull();
    expect(screen.getByText('No broadcasts yet')).toBeDefined();
  });

});
