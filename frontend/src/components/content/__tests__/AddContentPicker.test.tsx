import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { AddContentPicker } from '../AddContentPicker';

const files = [
  { id: 'f-img', filename: 'photo.png', mime_type: 'image/png', size_bytes: 2048, url: 'http://x/photo.png', tags: [], created_by: 'u1', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
  { id: 'f-pdf', filename: 'pricing.pdf', mime_type: 'application/pdf', size_bytes: 4096, url: 'http://x/pricing.pdf', tags: [], created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

const pages = [
  { id: 'p1', title: 'Pricing', slug: 'pricing', description: 'Plans', blocks: [], status: 'published', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
  { id: 'p2', title: 'Draft offer', slug: 'draft-offer', description: null, blocks: [], status: 'draft', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
];

vi.mock('@/api/files', () => ({
  useFiles: vi.fn(() => ({ data: files, isLoading: false, error: null })),
  useUploadFile: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/api/pages', () => ({
  usePages: vi.fn(() => ({ data: pages, isLoading: false })),
}));

describe('AddContentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not commit on thumbnail click — Add selected inserts a download link', () => {
    const onAddFile = vi.fn();
    renderWithProviders(
      <AddContentPicker open channel="email" editorMode="simple" onClose={() => undefined} onAddFile={onAddFile} onAddPage={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /photo\.png/i }));
    expect(onAddFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(onAddFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-img' }), 'link');
  });

  it('cancel closes without inserting anything', () => {
    const onAddFile = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <AddContentPicker open channel="email" editorMode="simple" onClose={onClose} onAddFile={onAddFile} onAddPage={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /photo\.png/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAddFile).not.toHaveBeenCalled();
  });

  it('hides Attach on SMS with an honest explanation', () => {
    renderWithProviders(
      <AddContentPicker open channel="sms" editorMode="simple" onClose={() => undefined} onAddFile={() => undefined} onAddPage={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pricing\.pdf/i }));
    // Download links remain available on SMS…
    expect(screen.getByRole('button', { name: 'Add selected' })).toBeEnabled();
    // …but the Attach option is disabled with an honest reason.
    expect(screen.getByLabelText(/Attach file/i)).toBeDisabled();
    expect(screen.getByText(/Attachments are not sent on this channel/i)).toBeInTheDocument();
  });

  it('shows published pages and explains drafts are not insertable', () => {
    renderWithProviders(
      <AddContentPicker open channel="email" editorMode="simple" onClose={() => undefined} onAddFile={() => undefined} onAddPage={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Landing pages' }));
    expect(screen.getByRole('button', { name: /Pricing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft offer/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Publish a page before sharing/i)).toBeInTheDocument();
  });

  it('blocks duplicate attachment selection by stable id', () => {
    renderWithProviders(
      <AddContentPicker
        open
        channel="email"
        editorMode="simple"
        onClose={() => undefined}
        onAddFile={() => undefined}
        onAddPage={() => undefined}
        alreadyAttachedIds={['f-pdf']}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pricing\.pdf/i }));
    fireEvent.click(screen.getByLabelText(/Attach file/i));
    expect(screen.getByText(/already attached to the current draft/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add selected' })).toBeDisabled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <AddContentPicker open channel="email" editorMode="simple" onClose={onClose} onAddFile={() => undefined} onAddPage={() => undefined} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('restricts placements when allowedPlacements is set (attach-only context)', () => {
    const onAddFile = vi.fn();
    renderWithProviders(
      <AddContentPicker
        open
        channel="email"
        editorMode="html"
        allowPages={false}
        allowedPlacements={['attach']}
        onClose={() => undefined}
        onAddFile={onAddFile}
        onAddPage={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /photo\.png/i }));
    expect(screen.queryByLabelText(/Add download link/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Insert image/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(onAddFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-img' }), 'attach');
  });
});
