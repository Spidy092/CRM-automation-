import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/lib/test-utils';
import { PublicNewsletterActionPage } from '../PublicNewsletterActionPage';
import { useNewsletterPreferences } from '@/api/newsletter';

const mocks = vi.hoisted(() => ({
  unsubscribe: vi.fn(),
  confirm: vi.fn(),
  updatePreferences: vi.fn(),
  retryPreferences: vi.fn(),
}));

vi.mock('@/api/newsletter', () => ({
  useConfirmSubscription: () => ({ mutateAsync: mocks.confirm, isPending: false }),
  useUnsubscribe: () => ({ mutateAsync: mocks.unsubscribe, isPending: false }),
  useNewsletterPreferences: vi.fn().mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: mocks.retryPreferences }),
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
  it('lets a subscriber choose topics and frequency without exposing their email address', async () => {
    mocks.updatePreferences.mockReset().mockResolvedValue({});
    vi.mocked(useNewsletterPreferences).mockReturnValue({ data: { topics: ['product_updates', 'promotions', 'company_news'],
      frequency: 'weekly', status: 'confirmed' }, isLoading: false, error: null,
    } as ReturnType<typeof useNewsletterPreferences>);
    const token = 'a'.repeat(64);
    renderAction(`/newsletter/preferences?token=${token}`);
    fireEvent.click(screen.getByLabelText('Product updates'));
    fireEvent.click(screen.getByLabelText('Promotions'));
    fireEvent.change(screen.getByLabelText('Maximum sending frequency'), { target: { value: 'monthly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith({ token,
      input: { topics: ['company_news'], frequency: 'monthly' } }));
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('offers a retry when subscriber preferences fail to load', async () => {
    mocks.retryPreferences.mockReset();
    vi.mocked(useNewsletterPreferences).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network unavailable'),
      refetch: mocks.retryPreferences,
    } as unknown as ReturnType<typeof useNewsletterPreferences>);

    renderAction(`/newsletter/preferences?token=${'a'.repeat(64)}`);
    expect(screen.getByText(/Couldn’t load your preferences/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryPreferences).toHaveBeenCalledOnce();
  });

  it('shows an unsubscribed state instead of editable preferences', () => {
    vi.mocked(useNewsletterPreferences).mockReturnValue({
      data: { topics: [], frequency: 'weekly', status: 'unsubscribed' },
      isLoading: false,
      error: null,
      refetch: mocks.retryPreferences,
    } as ReturnType<typeof useNewsletterPreferences>);

    renderAction(`/newsletter/preferences?token=${'a'.repeat(64)}`);
    expect(screen.getByText('You’re unsubscribed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Subscribe again' })).toHaveAttribute('href', '/subscribe');
    expect(screen.queryByRole('button', { name: 'Save Preferences' })).toBeNull();
  });

});
