import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useMessageSnippets } from '@/api/messages';
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
  useDuplicateTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(null),
    isPending: false,
  }),
  useArchiveTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useUnarchiveTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useRenameTemplate: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('@/api/messages', () => ({
  useMessageSnippets: vi.fn().mockReturnValue({
    data: [{
      id: 'snippet-1',
      title: 'Legacy introduction',
      channel: 'email',
      body: 'Hello {{first_name}}, thanks for connecting.',
      variables: ['first_name'],
      file_ids: [],
      created_by: 'u1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
    isLoading: false,
    error: null,
  }),
}));

const defaultSnippetHook = vi.mocked(useMessageSnippets).getMockImplementation()!;

afterEach(() => {
  vi.mocked(useMessageSnippets).mockImplementation(defaultSnippetHook);
});

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
  it('hides Saved snippets when the library is empty', () => {
    vi.mocked(useMessageSnippets).mockReturnValueOnce({ data: [], isLoading: false, error: null } as ReturnType<typeof useMessageSnippets>);
    renderWithProviders(<TemplatesPage />);
    expect(screen.queryByRole('tab', { name: 'Saved snippets' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All templates' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the saved-snippets tab when a search has no matches', () => {
    vi.mocked(useMessageSnippets).mockImplementation((filters = {}) => {
      const result = defaultSnippetHook(filters);
      return filters.search ? { ...result, data: [] } : result;
    });
    renderWithProviders(<TemplatesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Saved snippets' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved snippets' }), { target: { value: 'no-match' } });
    expect(screen.getByRole('tab', { name: 'Saved snippets' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No saved snippets found')).toBeInTheDocument();
  });

  it('keeps snippet loading errors accessible', () => {
    vi.mocked(useMessageSnippets).mockReturnValue({ data: undefined, isLoading: false, error: new Error('Load failed') } as ReturnType<typeof useMessageSnippets>);
    renderWithProviders(<TemplatesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Saved snippets' }));
    expect(screen.getByText('Failed to load saved snippets')).toBeInTheDocument();
  });

  it('offers Duplicate without the redundant Use action', () => {
    renderWithProviders(<TemplatesPage />);
    expect(screen.getByRole('button', { name: 'Duplicate Welcome Email' })).toHaveTextContent('Duplicate');
    expect(screen.queryByRole('button', { name: 'Use Welcome Email' })).not.toBeInTheDocument();
  });

  it('connects every gallery tab to its labelled panel', () => {
    renderWithProviders(<TemplatesPage />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);

    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      fireEvent.click(tab);
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: tab.textContent ?? '' })).toBe(panel);
      expect(panel).not.toHaveAttribute('hidden');
      for (const inactive of screen.getAllByRole('tabpanel', { hidden: true })) {
        if (inactive !== panel) expect(inactive).toHaveAttribute('hidden');
      }
    }
  });

  it('keeps saved snippets available in a read-only Templates tab', () => {
    renderWithProviders(<TemplatesPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Saved snippets' }));

    expect(screen.getByText('Legacy introduction')).toBeInTheDocument();
    expect(screen.getByText('Hello {{first_name}}, thanks for connecting.')).toBeInTheDocument();
    expect(screen.getByText(/submit that template for approval/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Snippet/i })).not.toBeInTheDocument();
  });
});
