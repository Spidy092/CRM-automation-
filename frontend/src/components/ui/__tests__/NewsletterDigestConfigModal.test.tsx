import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterDigestConfigModal } from '../NewsletterDigestConfigModal';
import { useDigestDraft } from '@/api/newsletter';

vi.mock('@/api/newsletter', () => ({
  useDigestConfig: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useDigestStatus: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useDigestDraft: vi.fn().mockReturnValue({ data: { draft: { subject: 'Original', htmlBody: '<p>Body</p>', status: 'draft', updatedAt: '2026-01-01' } }, isLoading: false }),
  useUpdateDigestConfig: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSaveDigestDraft: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useApproveDigestDraft: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useSetDigestAutoSend: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

describe('NewsletterDigestConfigModal', () => {
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
});
