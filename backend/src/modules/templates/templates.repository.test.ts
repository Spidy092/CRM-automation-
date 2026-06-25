jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findTemplates,
  findTemplateById,
  insertTemplate,
  updateTemplate,
  setApprovalStatus,
  deleteTemplate,
} from './templates.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findTemplates', () => {
  it('returns templates with hasMore false when fewer rows', async () => {
    mockQuery.mockResolvedValue([{ id: 't1' }]);
    const result = await findTemplates({ limit: 10 });
    expect(result.hasMore).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it('sets hasMore true when extra row fetched', async () => {
    mockQuery.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const result = await findTemplates({ limit: 1 });
    expect(result.hasMore).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it('applies channel filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findTemplates({ limit: 10, channel: 'email' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('channel ='), expect.any(Array));
  });

  it('applies search filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findTemplates({ limit: 10, search: 'welcome' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.any(Array));
  });

  it('applies cursor pagination', async () => {
    mockQuery.mockResolvedValue([]);
    await findTemplates({ limit: 10, cursorTs: '2026-01-01', cursorId: 'c1' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('created_at'), expect.any(Array));
  });
});

describe('findTemplateById', () => {
  it('returns template when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1' });
    const result = await findTemplateById('t1');
    expect(result?.id).toBe('t1');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findTemplateById('x')).toBeNull();
  });
});

describe('insertTemplate', () => {
  it('inserts and returns row', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', name: 'Test' });
    const result = await insertTemplate({
      name: 'Test',
      channel: 'email',
      subject: null,
      body: 'Hello',
      variables: [],
      created_by: 'u1',
    });
    expect(result.id).toBe('t1');
  });

  it('throws on null result', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      insertTemplate({ name: 'X', channel: 'email', subject: null, body: 'X', variables: [], created_by: 'u1' }),
    ).rejects.toThrow();
  });
});

describe('updateTemplate', () => {
  it('updates fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', name: 'Updated' });
    const result = await updateTemplate('t1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('returns existing when no fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1' });
    const result = await updateTemplate('t1', {});
    expect(result.id).toBe('t1');
  });

  it('throws 404 when not found with no fields', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateTemplate('x', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('setApprovalStatus', () => {
  it('sets approved status', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', approval_status: 'approved' });
    const result = await setApprovalStatus('t1', 'approved', 'admin-1', null);
    expect(result.approval_status).toBe('approved');
  });

  it('sets rejected status with reason', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1', approval_status: 'rejected', rejection_reason: 'Bad' });
    const result = await setApprovalStatus('t1', 'rejected', null, 'Bad');
    expect(result.approval_status).toBe('rejected');
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(setApprovalStatus('x', 'approved', null, null)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('deleteTemplate', () => {
  it('deletes successfully', async () => {
    mockQueryOne.mockResolvedValue({ id: 't1' });
    await deleteTemplate('t1');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('DELETE'), ['t1']);
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(deleteTemplate('x')).rejects.toMatchObject({ statusCode: 404 });
  });
});
