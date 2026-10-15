import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterBroadcastModal } from '../NewsletterBroadcastModal';

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn().mockResolvedValue({ enqueued: true }),
}));

vi.mock('@/api/newsletter', () => ({
  useBroadcast: vi.fn().mockReturnValue({ mutateAsync: mockMutateAsync, isPending: false }),
  useEligibleCount: vi.fn().mockReturnValue({ data: { eligible: 3 }, isLoading: false }),
  useTestSendNewsletter: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn().mockReturnValue({ data: { items: [] }, isLoading: false }),
}));

describe('NewsletterBroadcastModal editing workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockMutateAsync.mockResolvedValue({ enqueued: true });
  });
  it('defaults to the Blocks editor, not raw HTML', () => {
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    expect(screen.getByRole('group', { name: /content editing mode/i })).toBeDefined();
    expect(screen.getByLabelText(/paragraph text/i)).toBeDefined();
    expect(screen.queryByLabelText(/^content \(html\)$/i)).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: /schedule broadcast/i }));
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
    renderWithProviders(<NewsletterBroadcastModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Retry subject' } });
    fireEvent.change(screen.getByLabelText(/paragraph text/i), { target: { value: 'Content' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('group', { name: /preview device/i });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await screen.findByText('Broadcast enqueued.');
    expect(mockMutateAsync.mock.calls).toHaveLength(2);
    expect(mockMutateAsync.mock.calls[0][0].idempotencyKey).toBe(mockMutateAsync.mock.calls[1][0].idempotencyKey);
    expect(mockMutateAsync.mock.calls[0][0].idempotencyKey).not.toContain('Retry subject');
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

});
