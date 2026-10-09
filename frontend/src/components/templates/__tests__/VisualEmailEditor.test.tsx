import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { VisualEmailEditor } from '../VisualEmailEditor';
import { starterTemplates } from '@/lib/emailDesign';
import { useCreateTemplate, useUpdateTemplate } from '@/api/templates';

vi.mock('@/api/templates', () => ({
  useCreateTemplate: vi.fn(),
  useUpdateTemplate: vi.fn(),
}));

vi.mock('@/api/files', () => ({
  useFiles: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

const mutateAsync = vi.fn();

describe('VisualEmailEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 'new-1' });
    vi.mocked(useCreateTemplate).mockReturnValue({ mutateAsync, isPending: false } as ReturnType<typeof useCreateTemplate>);
    vi.mocked(useUpdateTemplate).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as ReturnType<typeof useUpdateTemplate>);
  });

  it('starts from a starter with editable blocks and saves the design document', async () => {
    const starter = starterTemplates().find((s) => s.key === 'personal-outreach');
    const onSaved = vi.fn();
    renderWithProviders(<VisualEmailEditor starter={starter ?? null} onSaved={onSaved} />);

    // Starter content is visible on the canvas.
    expect(screen.getByText(/came across/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Template name *'), { target: { value: 'My outreach' } });
    fireEvent.change(screen.getByLabelText('Subject *'), { target: { value: 'Hello {{business_name}}' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const input = mutateAsync.mock.calls[0][0];
    expect(input.editor_mode).toBe('visual');
    expect(input.channel).toBe('email');
    // Structured document preserved (not just HTML).
    expect(input.design.blocks.length).toBeGreaterThan(0);
    expect(input.design.blocks.some((b: { type: string }) => b.type === 'footer')).toBe(true);
    expect(input.variables).toEqual(expect.arrayContaining(['first_name', 'business_name']));
    expect(onSaved).toHaveBeenCalledWith('new-1');
  });

  it('adds, duplicates, reorders, and removes blocks with keyboard-operable controls', () => {
    const starter = starterTemplates().find((s) => s.key === 'thank-you');
    renderWithProviders(<VisualEmailEditor starter={starter ?? null} />);

    // Add a divider from the palette.
    fireEvent.click(screen.getByRole('button', { name: /\+ divider/i }));
    expect(screen.getByLabelText('divider block 5 of 5')).toBeInTheDocument();

    // Duplicate the first text block.
    const firstBlock = screen.getByLabelText('text block 1 of 5');
    const duplicateBtn = firstBlock.parentElement?.querySelector('button[aria-label^="Duplicate"]');
    expect(duplicateBtn).toBeTruthy();
    fireEvent.click(duplicateBtn as HTMLElement);

    // Move the selected block down via its button (keyboard alternative to drag-and-drop).
    const moveDown = screen.getAllByRole('button', { name: /move .* block down/i })[0];
    fireEvent.click(moveDown);

    // Undo reverts the move but keeps the duplicate: six blocks remain, and
    // two text blocks carry the duplicated content.
    fireEvent.click(screen.getByRole('button', { name: /undo change/i }));
    expect(screen.getAllByRole('option').length).toBe(6);
    const thankYouBlocks = screen
      .getAllByRole('option')
      .filter((el) => (el.textContent ?? '').includes('Thank you,'));
    expect(thankYouBlocks.length).toBe(2);
  });

  it('refuses to remove the last footer block (compliance guard)', () => {
    const starter = starterTemplates().find((s) => s.key === 'welcome');
    renderWithProviders(<VisualEmailEditor starter={starter ?? null} />);

    const footer = screen.getByLabelText('footer block 5 of 5');
    const removeBtn = footer.querySelector('button[aria-label^="Remove"]');
    fireEvent.click(removeBtn as HTMLElement);
    // Footer is still there.
    expect(screen.getByLabelText('footer block 5 of 5')).toBeInTheDocument();
  });

  it('inserts personalization variables into subject and block text', () => {
    renderWithProviders(<VisualEmailEditor starter={null} />);
    fireEvent.click(screen.getByRole('button', { name: /subject.*insert personalization variable/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: '{{first_name}}' }));
    expect(screen.getByLabelText('Subject *')).toHaveValue('{{first_name}}');
  });

  it('requires name, subject, and a footer before saving', async () => {
    renderWithProviders(<VisualEmailEditor starter={null} />);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/template name is required/i)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});


it('synchronizes both preheader controls and includes changes in undo history', () => {
  renderWithProviders(<VisualEmailEditor />);
  const fields = screen.getAllByLabelText('Preheader');
  fireEvent.change(fields[1], { target: { value: 'New preview text' } });
  expect(fields[0]).toHaveValue('New preview text');
  fireEvent.click(screen.getByRole('button', { name: 'Undo change' }));
  expect(fields[0]).toHaveValue('');
  expect(fields[1]).toHaveValue('');
});

it('lets keyboard users activate nested block action buttons', async () => {
  const user = userEvent.setup();
  renderWithProviders(<VisualEmailEditor starter={starterTemplates()[0]} />);
  const before = screen.getAllByRole('option').filter((el) => el.tagName === 'ARTICLE').length;
  screen.getAllByRole('button', { name: 'Duplicate text block' })[0].focus();
  await user.keyboard('{Enter}');
  expect(screen.getAllByRole('option').filter((el) => el.tagName === 'ARTICLE')).toHaveLength(before + 1);
});

it('notifies its page of unsaved visual edits', () => {
  const onDirtyChange = vi.fn();
  const starter = starterTemplates()[0];
  renderWithProviders(<VisualEmailEditor templateId="saved" initial={{ name: starter.name, subject: starter.subject, preheader: starter.preheader, design: starter.design }} onDirtyChange={onDirtyChange} />);
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: /\+ divider/i }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});
