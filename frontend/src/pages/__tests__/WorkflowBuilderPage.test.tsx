import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { WorkflowBuilderPage } from '../WorkflowBuilderPage';

const mutateCreate = vi.fn();
const mutateValidate = vi.fn();

vi.mock('@/api/workflows', () => ({
  useCreateWorkflow: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useValidateWorkflow: () => ({ mutateAsync: mutateValidate, isPending: false }),
}));

describe('WorkflowBuilderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutateValidate.mockResolvedValue({ valid: true, issues: [] });
    mutateCreate.mockResolvedValue({ id: 'workflow-1' });
  });

  it('builds and validates a trigger, action, and end graph', async () => {
    renderWithProviders(<WorkflowBuilderPage />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Qualify new leads' } });
    fireEvent.click(screen.getByRole('button', { name: /validate graph/i }));

    await waitFor(() => expect(mutateValidate).toHaveBeenCalledTimes(1));
    const definition = mutateValidate.mock.calls[0][0];
    expect(definition.name).toBe('Qualify new leads');
    expect(definition.entryNodeId).toBe('trigger');
    expect(definition.nodes.map((node: { type: string }) => node.type)).toEqual([
      'trigger',
      'action',
      'end',
    ]);
    expect(definition.nodes[1].action).toEqual({
      type: 'lead.add_tag',
      input: { tag: 'new-lead' },
    });
  });

  it('shows local JSON errors without calling the API', async () => {
    renderWithProviders(<WorkflowBuilderPage />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad input workflow' } });
    fireEvent.change(screen.getByLabelText('Action input JSON'), { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: /validate graph/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('valid JSON');
    expect(mutateValidate).not.toHaveBeenCalled();
  });

  it('validates before saving and creates a draft', async () => {
    renderWithProviders(<WorkflowBuilderPage />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Save me' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateValidate).toHaveBeenCalledTimes(1);
    expect(mutateCreate.mock.calls[0][0].name).toBe('Save me');
  });
});

