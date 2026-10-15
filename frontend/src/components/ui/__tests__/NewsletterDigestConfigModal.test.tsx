import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterDigestConfigModal } from '../NewsletterDigestConfigModal';
import { useDigestDraft } from '@/api/newsletter';

const { mockSaveDraft } = vi.hoisted(() => ({ mockSaveDraft: vi.fn() }));

vi.mock('@/api/newsletter', () => ({
  useDigestConfig: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useDigestStatus: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useDigestDraft: vi.fn().mockReturnValue({ data: { draft: { subject: 'Original', htmlBody: '<p>Body</p>', status: 'draft', updatedAt: '2026-01-01' } }, isLoading: false }),
  useUpdateDigestConfig: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSaveDigestDraft: vi.fn().mockReturnValue({ mutateAsync: mockSaveDraft, isPending: false }),
  useApproveDigestDraft: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSetDigestAutoSend: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

describe('NewsletterDigestConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDraft.mockResolvedValue({ subject: 'Original', htmlBody: '<p>Body</p>' });
  });

  it('preserves unsaved content on query refresh and prevents approval', () => {
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(<NewsletterDigestConfigModal onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Unsaved edit' } });
    expect(screen.getByRole('button', { name: 'Approve & send' })).toBeDisabled();
    vi.mocked(useDigestDraft).mockReturnValue({ data: { draft: { subject: 'Refetched', htmlBody: '<p>Body</p>', status: 'draft', createdAt: '2026-01-01', updatedAt: '2026-01-02' }, autoSend: true }, isLoading: false } as ReturnType<typeof useDigestDraft>);
    rerender(<NewsletterDigestConfigModal onClose={onClose} />);
    expect(screen.getByLabelText('Subject')).toHaveValue('Unsaved edit');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps edits made during save dirty and ignores refetches over edited content', async () => {
    let resolveSave!: (value: unknown) => void;
    mockSaveDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { rerender } = renderWithProviders(<NewsletterDigestConfigModal onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Submitted edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Newer unsaved edit' } });
    vi.mocked(useDigestDraft).mockReturnValue({
      data: { draft: { subject: 'Stale refetch', htmlBody: '<p>Stale</p>', status: 'draft', createdAt: '2026-01-01', updatedAt: '2026-01-02' }, autoSend: true },
      isLoading: false,
    } as ReturnType<typeof useDigestDraft>);
    rerender(<NewsletterDigestConfigModal onClose={() => undefined} />);
    expect(screen.getByLabelText('Subject')).toHaveValue('Newer unsaved edit');

    resolveSave({ subject: 'Submitted edit', htmlBody: '<p>Body</p>' });
    await screen.findByText('Draft saved for review.');
    expect(screen.getByLabelText('Subject')).toHaveValue('Newer unsaved edit');
    expect(screen.getByRole('button', { name: 'Approve & send' })).toBeDisabled();
  });

  it('closes only when the digest backdrop itself is clicked', () => {
    const onClose = vi.fn();
    renderWithProviders(<NewsletterDigestConfigModal onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
