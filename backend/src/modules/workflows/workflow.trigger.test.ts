jest.mock('./workflow.repository', () => ({
  findPublishedWorkflowCandidates: jest.fn(),
  createEnrollmentIfAbsent: jest.fn(),
}));

jest.mock('../../workers/queue', () => ({
  enqueueWorkflowExecution: jest.fn(),
}));

import { createEnrollmentIfAbsent, findPublishedWorkflowCandidates } from './workflow.repository';
import { enqueueWorkflowExecution } from '../../workers/queue';
import { enrollWorkflowsForEvent } from './workflow.trigger';

const mockFindCandidates = findPublishedWorkflowCandidates as jest.Mock;
const mockCreateEnrollment = createEnrollmentIfAbsent as jest.Mock;
const mockEnqueue = enqueueWorkflowExecution as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('workflow trigger enrollment', () => {
  it('maps the legacy stage_moved event, evaluates filters, and enqueues once', async () => {
    mockFindCandidates.mockResolvedValue([
      {
        workflow_id: 'workflow-1',
        workflow_version_id: 'version-1',
        trigger_node_id: 'trigger',
        definition: {},
        trigger: {
          event: 'lead.stage_changed',
          filters: { field: 'score', operator: 'gte', value: 70 },
        },
      },
    ]);
    mockCreateEnrollment.mockResolvedValue({ id: 'enrollment-1' });

    await expect(
      enrollWorkflowsForEvent({
        eventId: 'event-1',
        eventType: 'lead.stage_moved',
        leadId: 'lead-1',
        payload: { score: 90 },
      }),
    ).resolves.toEqual({ considered: 1, enrolled: 1, filtered: 0 });

    expect(mockFindCandidates).toHaveBeenCalledWith('lead.stage_changed');
    expect(mockCreateEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerEventId: 'event-1',
        triggerEventType: 'lead.stage_moved',
        currentNodeId: 'trigger',
      }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith({ enrollmentId: 'enrollment-1' });
  });

  it('fails closed when trigger filters do not match', async () => {
    mockFindCandidates.mockResolvedValue([
      {
        workflow_id: 'workflow-1',
        workflow_version_id: 'version-1',
        trigger_node_id: 'trigger',
        definition: {},
        trigger: {
          event: 'lead.created',
          filters: { field: 'status', operator: 'eq', value: 'qualified' },
        },
      },
    ]);

    await expect(
      enrollWorkflowsForEvent({
        eventId: 'event-2',
        eventType: 'lead.created',
        leadId: 'lead-1',
        payload: { status: 'new' },
      }),
    ).resolves.toEqual({ considered: 1, enrolled: 0, filtered: 1 });
    expect(mockCreateEnrollment).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('ignores event types with no workflow trigger contract', async () => {
    await expect(
      enrollWorkflowsForEvent({
        eventId: 'event-3',
        eventType: 'lead.scored',
        leadId: 'lead-1',
        payload: {},
      }),
    ).resolves.toEqual({ considered: 0, enrolled: 0, filtered: 0 });
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });
});
