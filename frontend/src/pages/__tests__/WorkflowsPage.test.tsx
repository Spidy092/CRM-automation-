import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { WorkflowsPage } from '../WorkflowsPage';

const mutatePublish = vi.fn();
const mutatePause = vi.fn();
const mutateResume = vi.fn();

vi.mock('@/api/workflows', () => ({
  useWorkflows: () => ({
    data: [{
      id: 'workflow-1',
      name: 'Qualify leads',
      description: 'Route high intent leads',
      status: 'draft',
      created_by: 'user-1',
      created_at: '2026-09-07T00:00:00.000Z',
      updated_at: '2026-09-07T00:00:00.000Z',
      deleted_at: null,
      current_version: {
        id: 'version-1',
        workflow_id: 'workflow-1',
        version: 1,
        definition: {
          name: 'Qualify leads',
          description: 'Route high intent leads',
          entryNodeId: 'trigger',
          nodes: [
            { id: 'trigger', type: 'trigger', next: ['action'], trigger: { event: 'lead.created' } },
            { id: 'action', type: 'action', next: ['end'], action: { type: 'lead.add_tag', input: { tag: 'hot' } } },
            { id: 'end', type: 'end', next: [] },
          ],
        },
        status: 'draft',
        created_by: 'user-1',
        published_at: null,
        created_at: '2026-09-07T00:00:00.000Z',
      },
    }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePublishWorkflow: () => ({ mutateAsync: mutatePublish, isPending: false }),
  usePauseWorkflow: () => ({ mutateAsync: mutatePause, isPending: false }),
  useResumeWorkflow: () => ({ mutateAsync: mutateResume, isPending: false }),
}));

describe('WorkflowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutatePublish.mockResolvedValue({});
    mutatePause.mockResolvedValue({});
    mutateResume.mockResolvedValue({});
  });

  it('lists workflow definitions and lifecycle status', () => {
    renderWithProviders(<WorkflowsPage />);
    expect(screen.getByText('Workflows')).toBeInTheDocument();
    expect(screen.getByText('Qualify leads')).toBeInTheDocument();
    expect(screen.getByText('lead.created')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('publishes a draft workflow from the catalog', async () => {
    renderWithProviders(<WorkflowsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(mutatePublish).toHaveBeenCalledWith('workflow-1'));
  });
});

