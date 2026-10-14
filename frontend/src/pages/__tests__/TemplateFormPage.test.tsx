import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplateFormPage } from '../TemplateFormPage';
import { useFiles } from '@/api/files';
import { useAttachTemplateFromLibrary, useCreateTemplate } from '@/api/templates';

let mockParams: { id?: string } = {};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => mockParams,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { data: null } }),
    post: vi.fn().mockResolvedValue({ data: { data: { id: 'new-template' } } }),
  },
}));

const { mockUploadMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockUploadMutateAsync: vi.fn().mockResolvedValue(undefined),
  mockDeleteMutateAsync: vi.fn().mockResolvedValue(undefined),
}));

const templateWithAttachment = {
  id: 'tmpl-1',
  name: 'Welcome',
  channel: 'email' as const,
  subject: 'Hi',
  body: 'Hello {{name}}',
  variables: ['name'],
  attachments: [
    {
      id: 'a1',
      filename: 'flyer.png',
      mimeType: 'image/png',
      sizeBytes: 2048,
      url: 'http://localhost:3000/uploads/templates/a1.png',
    },
  ],
  approval_status: 'pending' as const,
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  created_by: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/api/templates', () => ({
  useTemplate: vi.fn(() => ({
    data: mockParams.id === 'tmpl-1' ? templateWithAttachment : null,
    isLoading: false,
  })),
  useCreateTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-template' }),
    isPending: false,
  }),
  useUpdateTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUploadTemplateAttachment: vi.fn().mockReturnValue({
    mutateAsync: mockUploadMutateAsync,
    isPending: false,
  }),
  useAttachTemplateFromLibrary: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteTemplateAttachment: vi.fn().mockReturnValue({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
  useDuplicateTemplate: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveTemplate: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useUnarchiveTemplate: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useRenameTemplate: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  usePreviewTemplate: vi.fn().mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false }),
  useTestSendTemplate: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), data: null, isPending: false }),
}));

vi.mock('@/api/files', () => ({
  useFiles: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  useUploadFile: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/api/pages', () => ({
  usePages: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

describe('TemplateFormPage', () => {
  beforeEach(() => {
    mockParams = {};
    mockUploadMutateAsync.mockClear();
    mockDeleteMutateAsync.mockClear();
    vi.mocked(useFiles).mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useFiles>);
  });

  it('adds a portfolio button, saves its link, and keeps it while editing the message', async () => {
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'pdf-1', filename: 'school-portfolio.pdf', mime_type: 'application/pdf', size_bytes: 1024,
        url: 'https://files.example.com/portfolio.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
      { id: 'img-1', filename: 'photo.png', mime_type: 'image/png', size_bytes: 100,
        url: 'https://files.example.com/photo.png', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    renderWithProviders(<TemplateFormPage />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'School outreach' } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'Our portfolio' } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Hello school' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add portfolio button' }));
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /school-portfolio.pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(screen.getByRole('link', { name: 'View portfolio' })).toHaveAttribute('href', 'https://files.example.com/portfolio.pdf');
    expect(screen.getByLabelText(/body/i)).toHaveValue('Hello school');
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Hello principal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(useCreateTemplate().mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('data-crm-portfolio="true"'),
    })));
    expect(useCreateTemplate().mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({
      body: expect.stringContaining('Hello principal'),
    }));
  });

  it('removes the portfolio button without deleting the message', () => {
    mockParams = { id: 'tmpl-1' };
    const previousBody = templateWithAttachment.body;
    templateWithAttachment.body = 'Hello school <a data-crm-portfolio="true" href="https://files.example.com/p.pdf">View portfolio</a>';
    renderWithProviders(<TemplateFormPage />);
    templateWithAttachment.body = previousBody;
    fireEvent.click(screen.getByRole('button', { name: 'Remove portfolio button' }));
    expect(screen.queryByRole('link', { name: 'View portfolio' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/body/i)).toHaveValue('Hello school');
  });

  it('keeps the portfolio as a visible plain link when switching to SMS', () => {
    mockParams = { id: 'tmpl-1' };
    const previousBody = templateWithAttachment.body;
    templateWithAttachment.body = 'Hello school <a data-crm-portfolio="true" href="https://files.example.com/p.pdf">View portfolio</a>';
    renderWithProviders(<TemplateFormPage />);
    templateWithAttachment.body = previousBody;
    fireEvent.change(screen.getByLabelText(/channel/i), { target: { value: 'sms' } });
    expect(screen.getByLabelText(/body/i)).toHaveValue('Hello school\n\nView portfolio: https://files.example.com/p.pdf');
  });

  it('renders create template form', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByText('Create Template')).toBeDefined();
  });

  it('renders template name input', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByLabelText(/name/i)).toBeDefined();
  });

  it('renders channel selector', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByLabelText(/channel/i)).toBeDefined();
  });

  it('renders body textarea', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByLabelText(/body/i)).toBeDefined();
  });

  it('stages attachments before the first save instead of requiring a saved template', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByText(/No staged attachments/i)).toBeDefined();
    expect(screen.getByText(/Use “Add content” in the editor/i)).toBeDefined();
  });

  it('shows existing attachments and a remove button once editing a saved template', async () => {
    mockParams = { id: 'tmpl-1' };
    renderWithProviders(<TemplateFormPage />);

    await waitFor(() => {
      expect(screen.getByText('flyer.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove flyer.png' }));
    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith({ id: 'tmpl-1', attachmentId: 'a1' });
    });
  });

  it('inserts a file from the Add content picker without losing the draft', async () => {
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-1', filename: 'pricing.pdf', mime_type: 'application/pdf', size_bytes: 2048,
        url: 'https://files.example.com/pricing.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    renderWithProviders(<TemplateFormPage />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Launch' } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'News' } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Hello team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    expect(screen.getByRole('dialog', { name: 'Add content to template' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /pricing\.pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(screen.queryByRole('dialog', { name: 'Add content to template' })).not.toBeInTheDocument();
    const bodyValue = (screen.getByLabelText(/Message body/i) as HTMLTextAreaElement).value;
    expect(bodyValue).toContain('Hello team');
    expect(bodyValue).toContain('https://files.example.com/pricing.pdf');
  });

  it('cancel in the picker preserves editor text and inserts nothing', async () => {
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-1', filename: 'pricing.pdf', mime_type: 'application/pdf', size_bytes: 2048,
        url: 'https://files.example.com/pricing.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    renderWithProviders(<TemplateFormPage />);
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    fireEvent.click(screen.getByRole('button', { name: /pricing\.pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText(/body/i)).toHaveValue('Keep me');
  });

  it('retry after attachment failure reuses the created template instead of duplicating it', async () => {    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-1', filename: 'pricing.pdf', mime_type: 'application/pdf', size_bytes: 2048,
        url: 'https://files.example.com/pricing.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    const createMutate = vi.fn().mockResolvedValue({ id: 'tmpl-new' });
    vi.mocked(useCreateTemplate).mockReturnValue({ mutateAsync: createMutate, isPending: false } as ReturnType<typeof useCreateTemplate>);
    const attachMutate = vi.fn()
      .mockRejectedValueOnce(new Error('Attachment failed'))
      .mockResolvedValueOnce({ id: 'tmpl-new' });
    vi.mocked(useAttachTemplateFromLibrary).mockReturnValue({ mutateAsync: attachMutate, isPending: false } as ReturnType<typeof useAttachTemplateFromLibrary>);

    renderWithProviders(<TemplateFormPage />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Launch' } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: 'News' } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    fireEvent.click(screen.getByRole('button', { name: /pricing\.pdf/i }));
    fireEvent.click(screen.getByLabelText(/Attach file/i));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(screen.getByText(/Pending — attaches on save/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/will not create another template/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Retry 1 failed attachment/i }));
    await waitFor(() => expect(attachMutate).toHaveBeenCalledTimes(2));
    expect(createMutate).toHaveBeenCalledTimes(1);
  });

  it('pending file on an existing template offers Attach now (library reference, saved immediately)', async () => {
    mockParams = { id: 'tmpl-1' };
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-9', filename: 'deck.pdf', mime_type: 'application/pdf', size_bytes: 512,
        url: 'https://files.example.com/deck.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    const attachMutate = vi.fn().mockResolvedValue({ id: 'tmpl-1' });
    vi.mocked(useAttachTemplateFromLibrary).mockReturnValue({ mutateAsync: attachMutate, isPending: false } as ReturnType<typeof useAttachTemplateFromLibrary>);
    renderWithProviders(<TemplateFormPage />, { initialEntries: ['/templates/tmpl-1/edit?addFile=f-9'] });
    fireEvent.click(screen.getByRole('button', { name: 'Attach now' }));
    await waitFor(() => {
      expect(attachMutate).toHaveBeenCalledWith({ id: 'tmpl-1', fileId: 'f-9' });
    });
  });

  it('visual mode stages attachments before the first save via Add content', async () => {
    mockParams = {};
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-v', filename: 'hero.png', mime_type: 'image/png', size_bytes: 1024,
        url: 'https://files.example.com/hero.png', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    renderWithProviders(<TemplateFormPage />, { initialEntries: ['/templates/new?mode=visual'] });
    fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    expect(screen.getByRole('dialog', { name: 'Attach a file to this template' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Add download link/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hero\.png/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    expect(screen.getByText(/Pending — attaches on save/i)).toBeInTheDocument();
  });

  it('html mode attaches staged files after create without duplicating the template', async () => {
    mockParams = {};
    vi.mocked(useFiles).mockReturnValue({ data: [
      { id: 'f-h', filename: 'terms.pdf', mime_type: 'application/pdf', size_bytes: 1024,
        url: 'https://files.example.com/terms.pdf', tags: [], created_by: 'u1', created_at: '', updated_at: '' },
    ], isLoading: false } as ReturnType<typeof useFiles>);
    const createMutate = vi.fn().mockResolvedValue({ id: 'tmpl-html' });
    vi.mocked(useCreateTemplate).mockReturnValue({ mutateAsync: createMutate, isPending: false } as ReturnType<typeof useCreateTemplate>);
    const attachMutate = vi.fn().mockResolvedValue({ id: 'tmpl-html' });
    vi.mocked(useAttachTemplateFromLibrary).mockReturnValue({ mutateAsync: attachMutate, isPending: false } as ReturnType<typeof useAttachTemplateFromLibrary>);
    renderWithProviders(<TemplateFormPage />, { initialEntries: ['/templates/new?mode=html'] });
    fireEvent.change(screen.getByLabelText(/Template name/i), { target: { value: 'HTML launch' } });
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: 'News' } });
    fireEvent.change(screen.getByLabelText(/HTML content/i), { target: { value: '<p>Hello</p>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add content' }));
    fireEvent.click(screen.getByRole('button', { name: /terms\.pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create HTML template' }));
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(attachMutate).toHaveBeenCalledWith({ id: 'tmpl-html', fileId: 'f-h' });
    });
  });
});


it('prompts before switching away from unsaved visual work', () => {
  mockParams = {};
  renderWithProviders(<TemplateFormPage />, { initialEntries: ['/templates/new?mode=visual'] });
  fireEvent.click(screen.getByRole('button', { name: /\+ divider/i }));
  fireEvent.click(screen.getByRole('tab', { name: /^Simple$/i }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo change' })).toBeInTheDocument();
});
