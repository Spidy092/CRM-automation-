import {
  createSequence,
  getSequence,
  listSequences,
  updateSequence,
  removeSequence,
  createLog,
  updateLogStatus,
  getLeadLogs,
  createTask,
  getTask,
  updateTask,
  getLeadTimeline,
} from './outreach.service';

jest.mock('./outreach.repository', () => ({
  findSequences: jest.fn(),
  findSequenceById: jest.fn(),
  insertSequence: jest.fn(),
  updateSequence: jest.fn(),
  deleteSequence: jest.fn(),
  insertOutreachLog: jest.fn(),
  updateOutreachLogStatus: jest.fn(),
  findLogsByLead: jest.fn(),
  insertTask: jest.fn(),
  findTaskById: jest.fn(),
  updateTask: jest.fn(),
  findTimelineByLead: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import {
  findSequences,
  findSequenceById,
  insertSequence,
  updateSequence as updateSequenceRepo,
  deleteSequence,
  insertOutreachLog,
  updateOutreachLogStatus,
  findLogsByLead,
  insertTask,
  findTaskById,
  updateTask as updateTaskRepo,
  findTimelineByLead,
} from './outreach.repository';
import { writeAuditLog } from '../../shared/utils/audit';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

const baseSeq = {
  id: 's1',
  name: 'Welcome Series',
  steps: [{ stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: 't1' }],
  created_by: 'u1',
  created_at: '2026-06-19T00:00:00Z',
  updated_at: '2026-06-19T00:00:00Z',
};

const baseLog = {
  id: 'l1',
  lead_id: 'lead1',
  campaign_id: null,
  channel: 'email',
  template_id: 't1',
  step_number: 1,
  status: 'queued',
  external_msg_id: null,
  message_body: 'Hello',
  sent_at: null,
  delivered_at: null,
  opened_at: null,
  replied_at: null,
  error_message: null,
  created_at: '2026-06-19T00:00:00Z',
  updated_at: '2026-06-19T00:00:00Z',
};

const baseTask = {
  id: 'task1',
  lead_id: 'lead1',
  campaign_id: null,
  sequence_id: null,
  step_number: null,
  assigned_to: null,
  type: 'phone_call',
  title: 'Call lead',
  description: null,
  due_at: null,
  status: 'pending',
  completed_at: null,
  created_by: 'u1',
  created_at: '2026-06-19T00:00:00Z',
  updated_at: '2026-06-19T00:00:00Z',
};

// ── Sequences ───────────────────────────────────────────────────────────────

describe('listSequences', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated results', async () => {
    (findSequences as jest.Mock).mockResolvedValue([baseSeq]);
    const result = await listSequences(1, 0);
    expect(result.items).toHaveLength(1);
    expect(result.meta.limit).toBe(1);
  });
});

describe('getSequence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(null);
    await expect(getSequence('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns sequence when found', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    const result = await getSequence('s1');
    expect(result.id).toBe('s1');
  });
});

describe('createSequence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates and audits', async () => {
    (insertSequence as jest.Mock).mockResolvedValue(baseSeq);
    const result = await createSequence(
      { name: 'Welcome', steps: baseSeq.steps },
      actor,
    );
    expect(result.id).toBe('s1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence.created' }),
    );
  });
});

describe('updateSequence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates and audits', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (updateSequenceRepo as jest.Mock).mockResolvedValue({ ...baseSeq, name: 'Updated' });
    const result = await updateSequence('s1', { name: 'Updated' }, actor);
    expect(result.name).toBe('Updated');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence.updated' }),
    );
  });
});

describe('removeSequence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(null);
    await expect(removeSequence('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes and audits', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    await removeSequence('s1', actor);
    expect(deleteSequence).toHaveBeenCalledWith('s1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sequence.deleted' }),
    );
  });
});

// ── Outreach Logs ───────────────────────────────────────────────────────────

describe('createLog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a log', async () => {
    (insertOutreachLog as jest.Mock).mockResolvedValue(baseLog);
    const result = await createLog({
      leadId: 'lead1',
      channel: 'email',
      status: 'queued',
    });
    expect(result.id).toBe('l1');
  });
});

describe('updateLogStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates status to sent', async () => {
    const updated = { ...baseLog, status: 'sent', sent_at: '2026-06-19T01:00:00Z' };
    (updateOutreachLogStatus as jest.Mock).mockResolvedValue(updated);
    const result = await updateLogStatus('l1', 'sent', { sentAt: '2026-06-19T01:00:00Z' });
    expect(result.status).toBe('sent');
  });
});

describe('getLeadLogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns logs for a lead', async () => {
    (findLogsByLead as jest.Mock).mockResolvedValue([baseLog]);
    const result = await getLeadLogs('lead1');
    expect(result).toHaveLength(1);
    expect(findLogsByLead).toHaveBeenCalledWith('lead1', expect.any(Number));
  });
});

// ── Tasks ───────────────────────────────────────────────────────────────────

describe('getTask', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when missing', async () => {
    (findTaskById as jest.Mock).mockResolvedValue(null);
    await expect(getTask('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns task when found', async () => {
    (findTaskById as jest.Mock).mockResolvedValue(baseTask);
    const result = await getTask('task1');
    expect(result.id).toBe('task1');
  });
});

describe('createTask', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates and audits', async () => {
    (insertTask as jest.Mock).mockResolvedValue(baseTask);
    const result = await createTask(
      { leadId: 'lead1', type: 'phone_call', title: 'Call lead' },
      actor,
    );
    expect(result.id).toBe('task1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.created' }),
    );
  });
});

describe('updateTask', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates status and audits', async () => {
    (findTaskById as jest.Mock).mockResolvedValue(baseTask);
    (updateTaskRepo as jest.Mock).mockResolvedValue({ ...baseTask, status: 'completed' });
    const result = await updateTask('task1', { status: 'completed' }, actor);
    expect(result.status).toBe('completed');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task.updated' }),
    );
  });
});

// ── Timeline ────────────────────────────────────────────────────────────────

describe('getLeadTimeline', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns unified timeline entries', async () => {
    (findTimelineByLead as jest.Mock).mockResolvedValue([
      { id: 'l1', type: 'outreach_log', lead_id: 'lead1', campaign_id: null, status: 'sent', channel: 'email', body: 'Hello', created_at: '2026-06-19T00:00:00Z' },
    ]);
    const result = await getLeadTimeline('lead1');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('outreach_log');
  });
});
