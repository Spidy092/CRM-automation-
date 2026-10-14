import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { FilesLibraryPage } from '../FilesLibraryPage';

const files = [
  { id: 'f1', filename: 'a-very-long-product-photo-filename-that-truncates.png', mime_type: 'image/png', size_bytes: 2048, url: 'http://x/a.png', tags: ['product'], created_by: 'u1', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
  { id: 'f2', filename: 'pricing.pdf', mime_type: 'application/pdf', size_bytes: 4096, url: 'http://x/pricing.pdf', tags: [], created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

const { mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockDeleteMutateAsync: vi.fn().mockResolvedValue({ deleted: true }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/api/files', () => ({
  useFiles: vi.fn(() => ({ data: files, isLoading: false, error: null, refetch: vi.fn() })),
  useUploadFile: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteFile: vi.fn(() => ({ mutateAsync: mockDeleteMutateAsync, isPending: false })),
  useUpdateFile: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn(() => ({ data: { items: [], meta: { hasMore: false } }, isLoading: false, error: null })),
}));

describe('FilesLibraryPage', () => {
  it('shows a compact accurately-scoped summary, not metric cards', () => {
    renderWithProviders(<FilesLibraryPage />);
    expect(screen.getByText(/2 items · 1 image · 1 PDF/i)).toBeInTheDocument();
    expect(screen.queryByText('Total Files')).not.toBeInTheDocument();
  });

  it('distinguishes search matches from library totals', () => {
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: 'pricing' } });
    expect(screen.getByText(/1 match/i)).toBeInTheDocument();
    expect(screen.getByText(/2 total in library/i)).toBeInTheDocument();
  });

  it('shows a No matches state with Clear filters for empty search results', () => {
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.change(screen.getByLabelText(/Search files/i), { target: { value: 'zzz-no-such-file' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText(/2 items/i)).toBeInTheDocument();
  });

  it('opens a preview panel with Use in template and More actions', () => {
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: /Preview pricing\.pdf/i }));
    const dialog = screen.getByRole('dialog', { name: /File details/i });
    expect(within(dialog).getByRole('button', { name: 'Use in template' })).toBeInTheDocument();
    expect(screen.getByText(/anyone with this link can open the file/i)).toBeInTheDocument();
  });

  it('renames through an accessible dialog, not a native prompt', () => {
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getAllByRole('button', { name: /More actions/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('dialog', { name: 'Rename file' })).toBeInTheDocument();
    expect(screen.getByText(/file ID, not the name/i)).toBeInTheDocument();
  });

  it('delete warning describes actual broken-link behavior without archive language', () => {
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getAllByRole('button', { name: /More actions/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/deletion is blocked and the affected items are listed/i)).toBeInTheDocument();
    expect(screen.queryByText(/archive/i)).not.toBeInTheDocument();
  });

  it('blocks deletion and lists affected items when the file is referenced (409)', async () => {
    mockDeleteMutateAsync.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          error: 'Cannot delete "pricing.pdf" — it is still used.',
          meta: {
            references: {
              templates: [{ id: 't1', name: 'Welcome' }],
              pages: [{ id: 'p1', title: 'Pricing' }],
            },
          },
        },
      },
    });
    renderWithProviders(<FilesLibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getAllByRole('button', { name: /More actions/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Cannot delete/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText(/Raw download links.*not tracked/i)).toBeInTheDocument();
    mockDeleteMutateAsync.mockResolvedValue({ deleted: true });
  });
});
