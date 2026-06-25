import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplateFormPage } from '../TemplateFormPage';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({}),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { data: null } }),
    post: vi.fn().mockResolvedValue({ data: { data: { id: 'new-template' } } }),
  },
}));

vi.mock('@/api/templates', () => ({
  useTemplate: vi.fn().mockReturnValue({
    data: null,
    isLoading: false,
  }),
  useCreateTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-template' }),
    isPending: false,
  }),
  useUpdateTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe('TemplateFormPage', () => {
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
});
