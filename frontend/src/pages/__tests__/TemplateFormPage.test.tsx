import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplateFormPage } from '../TemplateFormPage';

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
}));

vi.mock('@/api/files', () => ({
  useFiles: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

describe('TemplateFormPage', () => {
  beforeEach(() => {
    mockParams = {};
    mockUploadMutateAsync.mockClear();
    mockDeleteMutateAsync.mockClear();
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

  it('prompts to save first before attachments are available on a new template', () => {
    renderWithProviders(<TemplateFormPage />);
    expect(screen.getByText(/Save the template first to attach/i)).toBeDefined();
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
});
