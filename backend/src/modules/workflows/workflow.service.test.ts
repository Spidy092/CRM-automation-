jest.mock('./workflow.repository', () => ({
  findWorkflowById: jest.fn(),
  findWorkflows: jest.fn(),
  insertWorkflow: jest.fn(),
  publishWorkflow: jest.fn(),
  replayFailedEnrollment: jest.fn(),
  updateWorkflowStatus: jest.fn(),
}));

jest.mock('../../workers/queue', () => ({
  enqueueWorkflowExecution: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { AppError } from '../../shared/middleware/errorHandler';
import * as repository from './workflow.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { enqueueWorkflowExecution } from '../../workers/queue';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  pauseWorkflow,
  publishWorkflow,
  replayWorkflowEnrollment,
  resumeWorkflow,
} from './workflow.service';
import type { WorkflowDetail } from './workflow.types';

const definition = {
  name: 'New lead',
  entryNodeId: 'trigger',
  nodes: [
    {
      id: 'trigger',
      type: 'trigger' as const,
      next: ['end'],
      trigger: { event: 'lead.created' as const },
    },
    { id: 'end', type: 'end' as const, next: [] },
  ],
};

const workflow: WorkflowDetail = {
  id: 'workflow-1',
  name: 'New lead',
  description: null,
  status: 'draft',
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  current_version: {
    id: 'version-1',
    workflow_id: 'workflow-1',
    version: 1,
    definition,
    status: 'draft',
    created_by: 'user-1',
    published_at: null,
    created_at: '2026-01-01T00:00:00Z',
  },
};

const mockedRepository = repository as jest.Mocked<typeof repository>;
const mockedAudit = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;
const mockedEnqueue = enqueueWorkflowExecution as jest.MockedFunction<typeof enqueueWorkflowExecution>;

describe('workflow service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists and gets workflows, returning a typed not-found error', async () => {
    mockedRepository.findWorkflows.mockResolvedValueOnce([workflow]);
    expect(await listWorkflows()).toEqual([workflow]);
    mockedRepository.findWorkflowById.mockResolvedValueOnce(workflow);
    expect(await getWorkflow('workflow-1')).toEqual(workflow);
    mockedRepository.findWorkflowById.mockResolvedValueOnce(null);
    await expect(getWorkflow('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('validates before creating a draft and writes an audit event', async () => {
    mockedRepository.insertWorkflow.mockResolvedValueOnce(workflow);
    const created = await createWorkflow(
      { name: 'New lead', definition },
      { id: 'user-1', ipAddress: '127.0.0.1' },
    );
    expect(created).toEqual(workflow);
    expect(mockedRepository.insertWorkflow).toHaveBeenCalledWith({
      name: 'New lead',
      definition,
      createdBy: 'user-1',
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.created' }),
    );
  });

  it('rejects an invalid graph before touching the repository', async () => {
    const invalidDefinition = { ...definition, entryNodeId: 'missing' };
    await expect(
      createWorkflow({ name: 'Invalid', definition: invalidDefinition }, { id: 'user-1' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mockedRepository.insertWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a definition whose name differs from the workflow name', async () => {
    await expect(
      createWorkflow(
        { name: 'Outer name', definition: { ...definition, name: 'Inner name' } },
        { id: 'user-1' },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(mockedRepository.insertWorkflow).not.toHaveBeenCalled();
  });

  it('publishes a valid draft and pauses only published workflows', async () => {
    mockedRepository.findWorkflowById.mockResolvedValueOnce(workflow);
    mockedRepository.publishWorkflow.mockResolvedValueOnce({ ...workflow, status: 'published' });
    expect(await publishWorkflow('workflow-1', { id: 'user-1' })).toMatchObject({
      status: 'published',
    });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.published' }),
    );

    mockedRepository.findWorkflowById.mockResolvedValueOnce(workflow);
    await expect(pauseWorkflow('workflow-1', { id: 'user-1' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockedRepository.updateWorkflowStatus).not.toHaveBeenCalled();
  });

  it('pauses a published workflow and records the state change', async () => {
    mockedRepository.findWorkflowById.mockResolvedValueOnce({ ...workflow, status: 'published' });
    mockedRepository.updateWorkflowStatus.mockResolvedValueOnce({ ...workflow, status: 'paused' });
    await expect(pauseWorkflow('workflow-1', { id: 'user-1' })).resolves.toMatchObject({
      status: 'paused',
    });
    expect(mockedRepository.updateWorkflowStatus).toHaveBeenCalledWith('workflow-1', 'paused');
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.paused' }),
    );
  });

  it('resumes a paused workflow and records the state change', async () => {
    mockedRepository.findWorkflowById.mockResolvedValueOnce({ ...workflow, status: 'paused' });
    mockedRepository.updateWorkflowStatus.mockResolvedValueOnce({
      ...workflow,
      status: 'published',
    });
    await expect(resumeWorkflow('workflow-1', { id: 'user-1' })).resolves.toMatchObject({
      status: 'published',
    });
    expect(mockedRepository.updateWorkflowStatus).toHaveBeenCalledWith('workflow-1', 'published');
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.resumed' }),
    );
  });

  it('replays a failed workflow run from its current node', async () => {
    const replayed = {
      id: 'enrollment-1',
      workflow_id: 'workflow-1',
      workflow_version_id: 'version-1',
      lead_id: 'lead-1',
      status: 'active' as const,
      current_node_id: 'action',
      trigger_event_id: 'event-1',
      trigger_event_type: 'lead.created',
      context: {},
      next_run_at: 'now',
      lock_version: 4,
      locked_at: null,
      locked_by: null,
      last_error: null,
      enrolled_at: 'now',
      finished_at: null,
      updated_at: 'now',
    };
    mockedRepository.replayFailedEnrollment.mockResolvedValueOnce(replayed);
    mockedEnqueue.mockResolvedValueOnce(undefined);

    await expect(
      replayWorkflowEnrollment('enrollment-1', {
        id: 'user-1',
        ipAddress: '127.0.0.1',
      }),
    ).resolves.toEqual(replayed);

    expect(mockedEnqueue).toHaveBeenCalledWith(
      { enrollmentId: 'enrollment-1' },
      { jobIdSuffix: 'replay-4' },
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.enrollment_replayed' }),
    );
  });

  it('keeps AppError available for consumers without leaking raw repository errors', () => {
    expect(new AppError('test', 422).statusCode).toBe(422);
  });
});
