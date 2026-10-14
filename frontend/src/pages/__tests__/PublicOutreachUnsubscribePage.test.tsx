import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { PublicOutreachUnsubscribePage } from '../PublicOutreachUnsubscribePage';

const mutate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ success: false }));
vi.mock('@/api/outreach', () => ({
  useUnsubscribeFeedback: () => ({ mutate: vi.fn(), isSuccess: false, isPending: false, isError: false }),
  useUnsubscribeOutreach: () => ({ mutate, isSuccess: state.success, isPending: false, isError: false }),
}));

describe('recipient unsubscribe confirmation', () => {
  it('requires confirmation instead of unsubscribing during a scanner visit', () => {
    mutate.mockClear();
    const token = 'a'.repeat(64);
    renderWithProviders(<PublicOutreachUnsubscribePage />, { initialEntries: [`/outreach/unsubscribe?token=${token}`] });
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unsubscribe' }));
    expect(mutate).toHaveBeenCalledWith(token);
  });

  it('does not offer confirmation for malformed tokens', () => {
    renderWithProviders(<PublicOutreachUnsubscribePage />, { initialEntries: ['/outreach/unsubscribe?token=invalid'] });
    expect(screen.getByRole('alert')).toHaveTextContent('invalid');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

it('offers optional feedback after opt-out and allows skipping', () => {
  state.success = true;
  renderWithProviders(<PublicOutreachUnsubscribePage />, { initialEntries: [`/outreach/unsubscribe?token=${'a'.repeat(64)}`] });
  expect(screen.getByLabelText('Why did you unsubscribe? (Optional)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  state.success = false;
});

it('helps visitors without a token', () => {
  renderWithProviders(<PublicOutreachUnsubscribePage />, { initialEntries: ['/unsubscribe'] });
  expect(screen.getByRole('alert')).toHaveTextContent('No login is required');
});
