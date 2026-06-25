import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplatesPage } from '../TemplatesPage';

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn().mockReturnValue({
    data: [
      {
        id: '1',
        name: 'Welcome Email',
        channel: 'email',
        subject: 'Welcome to our platform',
        body: 'Hi {{first_name}}, welcome!',
        variables: ['first_name'],
        approval_status: 'approved',
        rejection_reason: null,
      },
      {
        id: '2',
        name: 'WhatsApp Follow-up',
        channel: 'whatsapp',
        subject: null,
        body: 'Hi {{first_name}}, just following up...',
        variables: ['first_name'],
        approval_status: 'pending',
        rejection_reason: null,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useApproveTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useDeleteTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

describe('TemplatesPage', () => {
  it('renders successfully', () => {
    const { container } = renderWithProviders(<TemplatesPage />);
    expect(container).toBeTruthy();
  });

  it('renders page title', () => {
    renderWithProviders(<TemplatesPage />);
    expect(document.body.textContent).toContain('Templates');
  });

  it('renders template names', async () => {
    renderWithProviders(<TemplatesPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain('Welcome Email');
    expect(document.body.textContent).toContain('WhatsApp Follow-up');
  });

  it('renders approval status badges', () => {
    renderWithProviders(<TemplatesPage />);
    expect(document.body.textContent).toContain('approved');
    expect(document.body.textContent).toContain('pending');
  });

  it('renders new template button', () => {
    renderWithProviders(<TemplatesPage />);
    expect(document.body.textContent).toContain('New Template');
  });

  it('renders search input', () => {
    const { container } = renderWithProviders(<TemplatesPage />);
    const searchInput = container.querySelector('input[placeholder*="Search"]');
    expect(searchInput).toBeTruthy();
  });

  it('renders channel filter', () => {
    renderWithProviders(<TemplatesPage />);
    expect(document.body.textContent).toContain('All Channels');
  });
});
