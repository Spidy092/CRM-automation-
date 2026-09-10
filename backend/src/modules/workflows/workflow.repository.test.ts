jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  withTransaction: jest.fn(),
}));

import { pool, withTransaction } from '../../shared/utils/db';
import {
  claimDueEnrollments,
  createEnrollmentIfAbsent,
  findEnrollmentTimeline,
  findPublishedWorkflowCandidates,
  findWorkflowById,
  findWorkflows,
  insertWorkflow,
  publishWorkflow,
  recordStepRun,
  updateWorkflowStatus,
} from './workflow.repository';
import type { WorkflowDefinition } from './workflow.types';

const mockedPool = pool.query as jest.Mock;
const mockedTransaction = withTransaction as jest.Mock;

const definition: WorkflowDefinition = {
  name: 'New lead',
  entryNodeId: 'trigger',
  nodes: [
    { id: 'trigger', type: 'trigger', next: ['end'], trigger: { event: 'lead.created' } },
    { id: 'end', type: 'end', next: [] },
  ],
};

const row = {
  id: 'workflow-1',
  name: 'New lead',
  description: null,
  status: 'draft',
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  version_id: 'version-1',
  version_workflow_id: 'workflow-1',
  version_number: 1,
  version_definition: definition,
  version_status: 'draft',
  version_created_by: 'user-1',
  version_published_at: null,
  version_created_at: '2026-01-01T00:00:00Z',
};

describe('workflow repository', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps latest-version rows into workflow details', async () => {
    mockedPool.mockResolvedValueOnce({ rows: [row] });
    expect(await findWorkflows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workflow-1',
          current_version: expect.objectContaining({ version: 1 }),
        }),
      ]),
    );
    mockedPool.mockResolvedValueOnce({ rows: [] });
    await expect(findWorkflowById('missing')).resolves.toBeNull();
  });

  it('creates a workflow and its first version in one transaction', async () => {
    const client = { query: jest.fn() };
    mockedTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) => callback(client),
    );
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'workflow-1',
            name: 'New lead',
            description: null,
            status: 'draft',
            created_by: 'user-1',
            created_at: 'now',
            updated_at: 'now',
            deleted_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'version-1',
            workflow_id: 'workflow-1',
            version: 1,
            definition,
            status: 'draft',
            created_by: 'user-1',
            published_at: null,
            created_at: 'now',
          },
        ],
      });
    const created = await insertWorkflow({ name: 'New lead', definition, createdBy: 'user-1' });
    expect(created.current_version?.version).toBe(1);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('publishes the latest draft version atomically', async () => {
    const client = { query: jest.fn() };
    mockedTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) => callback(client),
    );
    client.query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'version-1',
            workflow_id: 'workflow-1',
            version: 1,
            definition,
            status: 'draft',
            created_by: 'user-1',
            published_at: null,
            created_at: 'now',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'version-1',
            workflow_id: 'workflow-1',
            version: 1,
            definition,
            status: 'published',
            created_by: 'user-1',
            published_at: 'now',
            created_at: 'now',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ ...row, status: 'published' }] });
    await expect(publishWorkflow('workflow-1')).resolves.toMatchObject({ status: 'published' });
    expect(client.query).toHaveBeenCalledTimes(5);
  });

  it('updates status and reloads the full detail', async () => {
    mockedPool.mockResolvedValueOnce({ rows: [{ id: 'workflow-1' }] });
    mockedPool.mockResolvedValueOnce({ rows: [row] });
    await expect(updateWorkflowStatus('workflow-1', 'paused')).resolves.toMatchObject({
      id: 'workflow-1',
    });
    expect(mockedPool).toHaveBeenCalledTimes(2);
  });

  it('finds only published workflow versions whose trigger matches an event', async () => {
    mockedPool.mockResolvedValueOnce({
      rows: [
        {
          workflow_id: 'workflow-1',
          workflow_version_id: 'version-1',
          definition,
          trigger_node_id: 'trigger',
          trigger: { event: 'lead.created' },
        },
      ],
    });
    await expect(findPublishedWorkflowCandidates('lead.created')).resolves.toHaveLength(1);
    expect(mockedPool).toHaveBeenCalledWith(expect.stringContaining('jsonb_array_elements'), [
      'lead.created',
    ]);
  });

  it('creates an enrollment idempotently from a trigger event', async () => {
    const enrollment = {
      id: 'enrollment-1',
      workflow_id: 'workflow-1',
      workflow_version_id: 'version-1',
      lead_id: 'lead-1',
      status: 'active',
      current_node_id: 'end',
      trigger_event_id: 'event-1',
      trigger_event_type: 'lead.created',
      context: { lead: { id: 'lead-1' } },
      next_run_at: null,
      lock_version: 0,
      locked_at: null,
      locked_by: null,
      last_error: null,
      enrolled_at: 'now',
      finished_at: null,
      updated_at: 'now',
    };
    mockedPool.mockResolvedValueOnce({ rows: [enrollment] });
    await expect(
      createEnrollmentIfAbsent({
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
        leadId: 'lead-1',
        currentNodeId: 'end',
        triggerEventId: 'event-1',
        triggerEventType: 'lead.created',
        context: enrollment.context,
      }),
    ).resolves.toEqual(enrollment);
    expect(mockedPool.mock.calls[0]?.[1]).toEqual([
      'workflow-1',
      'version-1',
      'lead-1',
      'end',
      'event-1',
      'lead.created',
      JSON.stringify(enrollment.context),
      null,
    ]);
  });

  it('claims due enrollments with a bounded limit and worker identity', async () => {
    mockedPool.mockResolvedValueOnce({ rows: [] });
    await expect(claimDueEnrollments('2026-09-07T00:00:00.000Z', 10, 'worker-1')).resolves.toEqual(
      [],
    );
    expect(mockedPool.mock.calls[0]?.[1]).toEqual(['2026-09-07T00:00:00.000Z', 10, 'worker-1']);
    await expect(claimDueEnrollments('now', 0, 'worker-1')).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('records step runs and reads a bounded enrollment timeline', async () => {
    const step = {
      id: 'step-1',
      enrollment_id: 'enrollment-1',
      node_id: 'action',
      node_type: 'action',
      status: 'running',
      attempt: 1,
      idempotency_key: 'enrollment-1:action',
      job_id: null,
      input: { channel: 'email' },
      result: null,
      error_code: null,
      error_message: null,
      started_at: 'now',
      finished_at: null,
      created_at: 'now',
    };
    mockedPool.mockResolvedValueOnce({ rows: [step] });
    await expect(
      recordStepRun({
        enrollmentId: 'enrollment-1',
        nodeId: 'action',
        nodeType: 'action',
        idempotencyKey: 'enrollment-1:action',
        input: { channel: 'email' },
        lockVersion: 1,
        workerId: 'worker-1',
      }),
    ).resolves.toEqual(step);
    mockedPool.mockResolvedValueOnce({ rows: [step] });
    await expect(findEnrollmentTimeline('enrollment-1', 25)).resolves.toEqual([step]);
    await expect(findEnrollmentTimeline('enrollment-1', 0)).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});
