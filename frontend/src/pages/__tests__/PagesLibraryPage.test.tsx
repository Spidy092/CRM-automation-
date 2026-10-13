import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { PagesLibraryPage } from '../PagesLibraryPage';

const pages = [
  { id: 'p1', title: 'Pricing', slug: 'pricing', description: 'Plans', blocks: [], status: 'published', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
  { id: 'p2', title: 'Draft offer', slug: 'draft-offer', description: null, blocks: [], status: 'draft', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/api/pages', () => ({
  usePages: vi.fn(() => ({ data: pages, isLoading: false, error: null, refetch: vi.fn() })),
  useDeletePage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  usePublishPage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUnpublishPage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn(() => ({ data: { items: [], meta: { hasMore: false } }, isLoading: false, error: null })),
}));

describe('PagesLibraryPage', () => {
  it('uses the Landing pages title with a compact total/published/draft summary', () => {
    renderWithProviders(<PagesLibraryPage />);
    expect(screen.getByRole('heading', { name: 'Landing pages' })).toBeInTheDocument();
    expect(screen.getByText(/2 total · 1 published · 1 draft/i)).toBeInTheDocument();
    expect(screen.queryByText('Total Pages')).not.toBeInTheDocument();
  });

  it('offers Use in template for published pages but not for drafts', () => {
    renderWithProviders(<PagesLibraryPage />);
    expect(screen.getByRole('button', { name: 'Use in template' })).toBeInTheDocument();
    expect(screen.getByText(/Publish this page before sharing/i)).toBeInTheDocument();
  });

  it('draft preview is labelled as not publicly shareable', () => {
    renderWithProviders(<PagesLibraryPage />);
    const previews = screen.getAllByRole('button', { name: 'Preview' });
    fireEvent.click(previews[1]);
    expect(screen.getByText(/not publicly shareable until you publish/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit and publish/i })).toBeInTheDocument();
  });

  it('distinguishes empty search results from an empty library', () => {
    renderWithProviders(<PagesLibraryPage />);
    fireEvent.change(screen.getByLabelText(/Search landing pages/i), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Pricing')).toBeInTheDocument();
  });

  it('delete warning describes actual behavior', () => {
    renderWithProviders(<PagesLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Draft offer' }));
    expect(screen.getByText(/links are not cleaned up automatically/i)).toBeInTheDocument();
  });
});
