import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/lib/test-utils';
import { PublicNewsletterActionPage } from '../PublicNewsletterActionPage';

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  confirm: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock('@/api/newsletter', () => ({
  useConfirmSubscription: () => ({ mutateAsync: mocks.confirm, isPending: false }),
  useUnsubscribe: () => ({ mutateAsync: mocks.unsubscribe, isPending: false }),
  useNewsletterPreferences: () => ({ data: undefined, isLoading: false, error: null }),
  useUpdateNewsletterPreferences: () => ({ mutateAsync: mocks.updatePreferences }),
}));

function renderAction(url: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/newsletter/:action" element={<PublicNewsletterActionPage />} />
    </Routes>,
    { initialEntries: [url] },
  );
}

describe('PublicNewsletterActionPage unsubscribe', () => {
  it('waits for an explicit confirmation instead of mutating on page load', async () => {
    mocks.unsubscribe.mockReset().mockResolvedValue({ message: 'You have been unsubscribed.' });
    const token = 'a'.repeat(64);

    renderAction(`/newsletter/unsubscribe?token=${token}`);

    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unsubscribe' }));
    await waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith(token));
    expect(await screen.findByText('Unsubscribed Successfully')).toBeInTheDocument();
  });

  it('does not offer a confirmation button for a malformed token', () => {
    mocks.unsubscribe.mockReset();
    renderAction('/newsletter/unsubscribe?token=invalid');

    expect(screen.getByRole('alert')).toHaveTextContent('invalid or incomplete');
    expect(screen.queryByRole('button', { name: 'Confirm unsubscribe' })).not.toBeInTheDocument();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });
});
