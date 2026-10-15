import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { NewsletterContactsModal } from '../NewsletterContactsModal';
import { useInfiniteLeads } from '@/api/leads';
const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/api/newsletter', () => ({ useAddNewsletterContacts: () => ({ mutateAsync: add, isPending: false }) }));
vi.mock('@/api/leads', () => ({ useInfiniteLeads: vi.fn() }));
const id = '550e8400-e29b-41d4-a716-446655440000';
const query = {
  data: { pages: [{ items: [
    { id, email: 'lead@example.com', business_name: 'Business', contact_name: 'Contact', status: 'active' },
    { id: '550e8400-e29b-41d4-a716-446655440001', email: 'optout@example.com', status: 'opted_out' },
  ] }] },
  isLoading: false, error: null, hasNextPage: false, refetch: vi.fn(),
};
function mockLeads(value: unknown): void {
  vi.mocked(useInfiniteLeads).mockReturnValue(value as ReturnType<typeof useInfiniteLeads>);
}
describe('NewsletterContactsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeads(query);
    add.mockResolvedValue({ added: 1, failed: 0, skipped: 0, failedLeadIds: [] });
  });
  it('adds selected CRM leads directly with topics/frequency and reports the result', async () => {
    renderWithProviders(<NewsletterContactsModal onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Select optout@example.com' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select lead@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected contacts' }));
    await screen.findByText(/1 contacts subscribed/);
    expect(add).toHaveBeenCalledWith({ leadIds: [id], frequency: 'weekly', topics: ['product_updates', 'promotions', 'company_news'] });
    expect(screen.getByRole('checkbox', { name: 'Select lead@example.com' })).not.toBeChecked();
  });
  it('requires selection and retains it after a request failure', async () => {
    add.mockRejectedValue(new Error('Network unavailable'));
    renderWithProviders(<NewsletterContactsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add selected contacts' }));
    await screen.findByText('Select at least one contact.');
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select lead@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected contacts' }));
    await screen.findByText('Network unavailable');
    expect(screen.getByRole('checkbox', { name: 'Select lead@example.com' })).toBeChecked();
  });
  it('keeps only failed contacts selected for a retry after partial success', async () => {
    add.mockResolvedValueOnce({ added: 1, failed: 1, skipped: 0, failedLeadIds: [id] });
    renderWithProviders(<NewsletterContactsModal onClose={vi.fn()} />);
    const contact = screen.getByRole('checkbox', { name: 'Select lead@example.com' });
    fireEvent.click(contact);
    fireEvent.click(screen.getByRole('button', { name: 'Add selected contacts' }));
    await screen.findByText(/1 could not be added; retry those contacts/);
    expect(contact).toBeChecked();
  });
  it('shows query errors and supports contact search', async () => {
    mockLeads({ ...query, data: undefined, error: new Error('failed') });
    renderWithProviders(<NewsletterContactsModal onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load contacts.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(query.refetch).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Search CRM contacts'), { target: { value: 'sales' } });
    await waitFor(() => expect(useInfiniteLeads).toHaveBeenCalledWith({ search: 'sales', limit: 25 }));
  });
});
