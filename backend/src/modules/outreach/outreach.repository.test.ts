jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findSequences,
  findSequenceById,
  insertSequence,
  updateSequence,
  deleteSequence,
  insertOutreachLog,
  updateOutreachLogStatus,
  findLogsByLead,
  insertTask,
  findTaskById,
  updateTask,
  findTimelineByLead,
} from './outreach.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findSequences', () => {
  it('queries with limit and offset', async () => {
    mockQuery.mockResolvedValue([{ id: 's1' }]);
    const result = await findSequences(10, 0);
    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT'), [10, 0]);
  });
});

describe('findSequenceById', () => {
  it('returns sequence when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 's1', name: 'Test' });
    const result = await findSequenceById('s1');
    expect(result?.id).toBe('s1');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await findSequenceById('missing');
    expect(result).toBeNull();
  });
});

describe('insertSequence', () => {
  it('inserts and returns row', async () => {
    mockQueryOne.mockResolvedValue({ id: 's1', name: 'Test' });
    const result = await insertSequence({ name: 'Test', steps: [], created_by: 'u1' });
    expect(result.id).toBe('s1');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('INSERT'), expect.any(Array));
  });

  it('throws on null result', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(insertSequence({ name: 'X', steps: [], created_by: 'u1' })).rejects.toThrow();
  });
});

describe('updateSequence', () => {
  it('updates name', async () => {
    mockQueryOne.mockResolvedValue({ id: 's1', name: 'Updated' });
    const result = await updateSequence('s1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('returns existing when no fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 's1', name: 'Existing' });
    const result = await updateSequence('s1', {});
    expect(result.id).toBe('s1');
  });

  it('throws 404 when not found with no fields', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateSequence('missing', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('deleteSequence', () => {
  it('deletes successfully', async () => {
    mockQueryOne.mockResolvedValue({ id: 's1' });
    await deleteSequence('s1');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('DELETE'), ['s1']);
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(deleteSequence('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('insertOutreachLog', () => {
  it('inserts and returns log', async () => {
    mockQueryOne.mockResolvedValue({ id: 'l1', channel: 'email' });
    const result = await insertOutreachLog({
      lead_id: 'lead1',
      campaign_id: null,
      channel: 'email',
      template_id: null,
      step_number: 1,
      status: 'queued',
      message_body: null,
    });
    expect(result.id).toBe('l1');
  });
});

describe('updateOutreachLogStatus', () => {
  it('updates status with extras', async () => {
    mockQueryOne.mockResolvedValue({ id: 'l1', status: 'sent' });
    const result = await updateOutreachLogStatus('l1', 'sent', {
      sentAt: '2026-01-01T00:00:00Z',
      externalMsgId: 'ext-1',
    });
    expect(result.status).toBe('sent');
  });

  it('throws 404 when log not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateOutreachLogStatus('x', 'sent')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('findLogsByLead', () => {
  it('returns logs for lead', async () => {
    mockQuery.mockResolvedValue([{ id: 'l1' }]);
    const result = await findLogsByLead('lead1', 50);
    expect(result).toHaveLength(1);
  });
});

describe('insertTask', () => {
  it('inserts and returns task', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', type: 'phone_call' });
    const result = await insertTask({
      lead_id: 'lead1',
      campaign_id: null,
      sequence_id: null,
      step_number: null,
      assigned_to: null,
      type: 'phone_call',
      title: 'Call',
      description: null,
      due_at: null,
      created_by: 'u1',
    });
    expect(result.id).toBe('t1');
  });
});

describe('findTaskById', () => {
  it('returns task when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1' });
    const result = await findTaskById('t1');
    expect(result?.id).toBe('t1');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findTaskById('x')).toBeNull();
  });
});

describe('updateTask', () => {
  it('updates task fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', status: 'completed' });
    const result = await updateTask('t1', { status: 'completed' });
    expect(result.status).toBe('completed');
  });

  it('returns existing when no fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1' });
    const result = await updateTask('t1', {});
    expect(result.id).toBe('t1');
  });

  it('throws 404 when not found with no fields', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateTask('x', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('findTimelineByLead', () => {
  it('returns timeline entries', async () => {
    mockQuery.mockResolvedValue([{ id: 'e1', type: 'outreach_log' }]);
    const result = await findTimelineByLead('lead1', 50);
    expect(result).toHaveLength(1);
  });
});
