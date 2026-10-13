import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { PageEditorPage } from '../PageEditorPage';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({}), useNavigate: () => vi.fn() };
});

vi.mock('@/api/pages', () => ({
  usePage: vi.fn(() => ({ data: null })),
  useCreatePage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdatePage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  usePublishPage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUnpublishPage: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/api/files', () => ({
  useFiles: vi.fn(() => ({ data: [], isLoading: false })),
  useUploadFile: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

describe('PageEditorPage content reuse', () => {
  it('saves as a private draft and keeps publishing explicit', () => {
    renderWithProviders(<PageEditorPage />);
    expect(screen.getByText(/private draft until you publish/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  });

  it('offers neutral editable presets for new pages', () => {
    renderWithProviders(<PageEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }));
    expect(screen.getByLabelText(/Title/i)).toHaveValue('Pricing');
    expect(screen.getByText(/edit the placeholders before publishing/i)).toBeInTheDocument();
  });

  it('draft preview is labelled as not publicly shareable', () => {
    renderWithProviders(<PageEditorPage />);
    fireEvent.change(screen.getByLabelText(/Title/i), { target: { value: 'My page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText(/not publicly shareable until you publish/i)).toBeInTheDocument();
  });
});
