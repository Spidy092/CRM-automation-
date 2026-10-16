import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterBroadcastModal } from '../NewsletterBroadcastModal';
import { useEligibleCount } from '@/api/newsletter';

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({ enqueued: true }),
}));

vi.mock('@/api/newsletter', () => ({
  useSaveNewsletterDraft: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSendNewsletterDraft: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useBroadcast: vi.fn().mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false }),
  useEligibleCount: vi.fn(),
  useTestSendNewsletter: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn().mockReturnValue({ data: { items: [] }, isLoading: false }),
}));

describe('NewsletterBroadcastModal editing workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(useEligibleCount).mockReturnValue({ data: { eligible: 3, total: 3, pending: 0,
      unsubscribed: 0, topicMismatch: 0, frequencyMismatch: 0, waiting: 0, reserved: 0, nextEligibleAt: null },
      isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useEligibleCount>);
    mockMutateAsync.mockResolvedValue({ enqueued: true });
  });
  it('defaults to the Blocks editor, not raw HTML', () => {
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    expect(screen.getByRole('group', { name: /content editing mode/i })).toBeDefined();
    expect(screen.getByLabelText(/paragraph text/i)).toBeDefined();
    expect(screen.queryByLabelText(/^content \(html\)$/i)).toBeNull();
  });


  it('defaults scheduled sends to India time', async () => {
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Timezone default' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect((screen.getByLabelText(/timezone/i) as HTMLSelectElement).value).toBe('Asia/Kolkata');
  });

  it('keeps HTML editing as an advanced option', () => {
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /html \(advanced\)/i }));
    expect(screen.getByLabelText(/^content \(html\)$/i)).toBeDefined();
  });

  it('reopens a saved draft including subject', () => {
    localStorage.setItem(
      'newsletter:broadcast:draft',
      JSON.stringify({ subject: 'Drafted subject', editMode: 'blocks', blocks: [] }),
    );
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    expect((screen.getByLabelText(/subject/i) as HTMLInputElement).value).toBe('Drafted subject');
  });

  it('blocks Continue on step 0 until subject and content exist', async () => {
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/subject is required/i)).toBeDefined();
  });

  it('sends compiled block HTML, honoring the selected timezone field', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValue({ enqueued: true, scheduledAt: '2026-05-01T03:30:00.000Z' });
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Block body' } });
    // Step through to Review & send (Continue validates step 0).
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('group', { name: /preview device/i })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText(/schedule \(optional\)/i), { target: { value: '2026-05-01T09:00' } });
    await user.selectOptions(screen.getByLabelText(/timezone/i), 'Asia/Kolkata');
    fireEvent.click(screen.getByRole('button', { name: /schedule for 3 subscribers/i }));
    await screen.findByText(/scheduled/i);
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlBody: expect.stringContaining('Block body'),
        scheduledAtLocal: '2026-05-01T09:00',
        timezone: 'Asia/Kolkata',
      }),
    );
    expect(mockMutateAsync).not.toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: expect.anything() }));
  });
  it('reuses the composition key when an ambiguous request is retried', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network timeout')).mockResolvedValueOnce({ enqueued: true });
    const first = renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Retry subject' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('group', { name: /preview device/i });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 3 subscribers' }));
    await screen.findByRole('alert');
    const firstKey = mockMutateAsync.mock.calls[0][0].idempotencyKey;
    first.unmount();
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('group', { name: /preview device/i });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to 3 subscribers' }));
    await screen.findByText('Newsletter queued for sending.');
    expect(mockMutateAsync.mock.calls).toHaveLength(2);
    expect(mockMutateAsync.mock.calls[0][0].idempotencyKey).toBe(mockMutateAsync.mock.calls[1][0].idempotencyKey);
    expect(mockMutateAsync.mock.calls[1][0].idempotencyKey).toBe(firstKey);
    expect(mockMutateAsync.mock.calls[0][0].idempotencyKey).not.toContain('Retry subject');
  });

  it('closes only when the broadcast backdrop itself is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(<NewsletterBroadcastModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses its content, wraps Tab, and restores the opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText(/template \(approved/i));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('shows a retryable error instead of a false zero when recipient checking fails', async () => {
    const retry = vi.fn();
    vi.mocked(useEligibleCount).mockReturnValue({ data: undefined, error: new Error('Unavailable'),
      isLoading: false, isFetching: false, refetch: retry,
    } as unknown as ReturnType<typeof useEligibleCount>);
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Couldn’t check recipients.')).toBeInTheDocument();
    expect(screen.queryByText('Nobody can receive this newsletter right now')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry recipient check' }));
    expect(retry).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: /Send to 0 subscribers/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('explains zero recipients and keeps sending blocked while drafts remain available', async () => {
    vi.mocked(useEligibleCount).mockReturnValue({ data: { eligible: 0, total: 7, pending: 2,
      unsubscribed: 0, topicMismatch: 2, frequencyMismatch: 0, waiting: 3, reserved: 0,
      nextEligibleAt: '2026-10-22T03:30:00.000Z' }, isLoading: false, isFetching: false, error: null,
    } as unknown as ReturnType<typeof useEligibleCount>);
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Nobody can receive this newsletter right now')).toBeInTheDocument();
    expect(screen.getByText('2 awaiting email confirmation')).toBeInTheDocument();
    expect(screen.getByText('3 received a newsletter recently')).toBeInTheDocument();
    expect(screen.getByText(/Next sending limit expires:.*IST/)).toBeInTheDocument();
    expect(screen.getByLabelText('Product updates')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Send to 0 subscribers' })).toBeDisabled();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('explains every exclusion reason for a selected audience', async () => {
    vi.mocked(useEligibleCount).mockReturnValue({ data: { eligible: 0, total: 9, pending: 1,
      unsubscribed: 2, topicMismatch: 1, frequencyMismatch: 1, waiting: 2, reserved: 2,
      nextEligibleAt: null }, isLoading: false, isFetching: false, error: null,
    } as unknown as ReturnType<typeof useEligibleCount>);
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('1 awaiting email confirmation')).toBeInTheDocument();
    expect(screen.getByText('2 unsubscribed')).toBeInTheDocument();
    expect(screen.getByText(/1 don’t match the selected topics/)).toBeInTheDocument();
    expect(screen.getByText(/1 don’t match the advanced audience filter/)).toBeInTheDocument();
    expect(screen.getByText('2 received a newsletter recently')).toBeInTheDocument();
    expect(screen.getByText('2 have a send in progress or awaiting review')).toBeInTheDocument();
  });

});
