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
  sendQuickMessage,
  sendManualOutreach,
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
jest.mock('../leads/leads.repository', () => ({ findLeadById: jest.fn() }));
jest.mock('../templates/templates.repository', () => ({ findTemplateById: jest.fn() }));
jest.mock('./outreach.prompt', () => ({ personalizeMessage: jest.fn() }));
jest.mock('../integrations/dispatch', () => ({ dispatchOutbound: jest.fn() }));

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
import { findLeadById } from '../leads/leads.repository';
import { findTemplateById } from '../templates/templates.repository';
import { personalizeMessage } from './outreach.prompt';
import { dispatchOutbound } from '../integrations/dispatch';

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

// ── Quick send ──────────────────────────────────────────────────────────────

describe('sendQuickMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseLead = {
    id: 'lead1',
    status: 'active',
    email: 'lead@example.com',
    phone: '+15551234567',
  };

  const baseTemplate = {
    id: 't1',
    channel: 'email',
    subject: 'Hi there',
    body: 'Hello {business_name}',
    approval_status: 'approved',
    attachments: [],
  };

  it('rejects a lead that does not exist', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(
      sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor),
    ).rejects.toThrow('Lead not found');
  });

  it('rejects an opted-out lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseLead, status: 'opted_out' });
    await expect(
      sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor),
    ).rejects.toThrow('opted out');
  });

  it('rejects when the template channel does not match', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseLead);
    (findTemplateById as jest.Mock).mockResolvedValue({ ...baseTemplate, channel: 'sms' });
    await expect(
      sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor),
    ).rejects.toThrow('channel mismatch');
  });

  it('rejects an unapproved template', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseLead);
    (findTemplateById as jest.Mock).mockResolvedValue({ ...baseTemplate, approval_status: 'pending' });
    await expect(
      sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor),
    ).rejects.toThrow('not approved');
  });

  it('sends, logs with a null campaign_id, and audits on success', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseLead);
    (findTemplateById as jest.Mock).mockResolvedValue(baseTemplate);
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello Acme' });
    (insertOutreachLog as jest.Mock).mockResolvedValue({ ...baseLog, status: 'queued' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: true, externalId: 'ext1', latencyMs: 10, retryable: false });
    (updateOutreachLogStatus as jest.Mock).mockResolvedValue({ ...baseLog, status: 'sent', external_msg_id: 'ext1' });

    const result = await sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor);

    expect(insertOutreachLog).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: 'lead1', campaign_id: null, template_id: 't1' }),
    );
    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: null, destination: 'lead@example.com' }),
    );
    expect(result.status).toBe('sent');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'outreach.quick_send' }),
    );
  });

  it('marks the log failed and throws when dispatch fails', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseLead);
    (findTemplateById as jest.Mock).mockResolvedValue(baseTemplate);
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello Acme' });
    (insertOutreachLog as jest.Mock).mockResolvedValue({ ...baseLog, status: 'queued' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: false, error: 'boom', latencyMs: 10, retryable: false });
    (updateOutreachLogStatus as jest.Mock).mockResolvedValue({ ...baseLog, status: 'failed', error_message: 'boom' });

    await expect(
      sendQuickMessage('lead1', { channel: 'email', templateId: 't1' }, actor),
    ).rejects.toThrow('Quick send failed');
    expect(updateOutreachLogStatus).toHaveBeenCalledWith('l1', 'failed', expect.objectContaining({ errorMessage: 'boom' }));
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('sendManualOutreach', () => {
  const actor = { id: 'user1', role: 'admin' as const };
  const baseLead = { id: 'lead1', status: 'active', email: 'lead@example.com' };

  it('rejects an opted-out lead with specific opted out message', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseLead, status: 'opted_out' });
    await expect(
      sendManualOutreach(
        {
          leadId: 'lead1',
          campaignId: 'c1',
          sequenceId: 's1',
          stepNumber: 1,
          channel: 'email',
          templateId: 't1',
        },
        actor,
      ),
    ).rejects.toThrow('Lead has opted out of outreach');
  });

  it('rejects an inactive non-opted-out lead with inactive message', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseLead, status: 'inactive' });
    await expect(
      sendManualOutreach(
        {
          leadId: 'lead1',
          campaignId: 'c1',
          sequenceId: 's1',
          stepNumber: 1,
          channel: 'email',
          templateId: 't1',
        },
        actor,
      ),
    ).rejects.toThrow('Lead is not active');
  });
});
