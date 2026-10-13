import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { TemplateChooser } from '../TemplateChooser';

vi.mock('@/api/templates', () => ({
  useTemplates: vi.fn(() => ({
    data: {
      items: [
        { id: 't1', name: 'Welcome', channel: 'email', approval_status: 'approved' },
        { id: 't2', name: 'Follow-up', channel: 'whatsapp', approval_status: 'pending' },
      ],
      meta: { hasMore: false },
    },
    isLoading: false,
    error: null,
  })),
}));

describe('TemplateChooser', () => {
  it('choosing a template carries the id without persisting anything itself', () => {
    const onChoose = vi.fn();
    renderWithProviders(
      <TemplateChooser open itemDescription="photo.png" onClose={() => undefined} onChoose={onChoose} onCreateNew={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Welcome/i }));
    expect(onChoose).toHaveBeenCalledWith('t1');
  });

  it('offers an explicit create-new-template option', () => {
    const onCreateNew = vi.fn();
    renderWithProviders(
      <TemplateChooser open itemDescription="photo.png" onClose={() => undefined} onChoose={() => undefined} onCreateNew={onCreateNew} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it('closes on Escape without choosing', () => {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <TemplateChooser open itemDescription="photo.png" onClose={onClose} onChoose={onChoose} onCreateNew={() => undefined} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });
});
