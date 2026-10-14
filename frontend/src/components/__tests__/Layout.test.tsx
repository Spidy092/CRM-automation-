import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { Layout } from '../Layout';
import { ContentTabs } from '../ContentTabs';

vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({ data: { success: true } })
  }
}));

describe('Layout', () => {
  it.each(['/outreach/sequences', '/files', '/pages', '/pages/example/edit'])('keeps Content active on %s', (path) => {
    renderWithProviders(<Layout />, { initialEntries: [path] });
    expect(screen.getByRole('link', { name: 'Content' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Content' })).toHaveClass('bg-slate-950');
    expect(screen.queryByText('CRM', { selector: 'header p' })).not.toBeInTheDocument();
  });

  it('keeps Templates active on template routes', () => {
    renderWithProviders(<Layout />, { initialEntries: ['/templates'] });
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveClass('bg-slate-950');
  });

  it('keeps only sequences, files, and landing pages in the Content tabs', () => {
    renderWithProviders(<ContentTabs />, { initialEntries: ['/outreach/sequences'] });
    expect(screen.getByRole('link', { name: 'Sequences' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Landing pages' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Messages' })).not.toBeInTheDocument();
  });

  it('renders successfully', () => {
    const { container } = renderWithProviders(<Layout />);
    expect(container).toBeTruthy();
  });


  it('keeps AI approvals in the Copilot panel rather than the sidebar', () => {
    renderWithProviders(<Layout />);
    expect(screen.queryByRole('link', { name: 'AI Copilot Inbox' })).not.toBeInTheDocument();
  });
});
