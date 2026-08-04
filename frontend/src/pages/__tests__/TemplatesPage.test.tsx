import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplatesPage } from '../TemplatesPage';

const { mockApproveMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockApproveMutateAsync: vi.fn().mockResolvedValue({}),
  mockDeleteMutateAsync: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: { id: 'u1', role: 'admin', name: 'Admin', email: 'a@b.com' } }),
}));

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn().mockReturnValue({
    data: {
      items: [
        {
          id: '1',
          name: 'Welcome Email',
          channel: 'email',
          subject: 'Welcome to our platform',
          body: 'Hi {{first_name}}, welcome!',
          variables: ['first_name'],
          attachments: [],
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
          attachments: [],
          approval_status: 'pending',
          rejection_reason: null,
        },
      ],
      meta: { hasMore: false },
    },
    isLoading: false,
    error: null,
  }),
  useApproveTemplate: vi.fn().mockReturnValue({
    mutateAsync: mockApproveMutateAsync,
    isPending: false,
  }),
  useDeleteTemplate: vi.fn().mockReturnValue({
    mutateAsync: mockDeleteMutateAsync,
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

  it('renders new template button for admin', () => {
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

  it('renders pagination controls', () => {
    renderWithProviders(<TemplatesPage />);
    expect(document.body.textContent).toContain('Rows per page');
  });
});
