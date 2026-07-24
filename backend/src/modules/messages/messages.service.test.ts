jest.mock('./messages.repository', () => ({
  findMessageSnippets: jest.fn(),
  findMessageSnippetById: jest.fn(),
  insertMessageSnippet: jest.fn(),
  updateMessageSnippet: jest.fn(),
  softDeleteMessageSnippet: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import {
  listMessageSnippets,
  getMessageSnippet,
  createMessageSnippet,
  updateMessageSnippet,
  removeMessageSnippet,
} from './messages.service';
import {
  findMessageSnippets,
  findMessageSnippetById,
  insertMessageSnippet,
  updateMessageSnippet as updateMessageSnippetRepo,
  softDeleteMessageSnippet,
} from './messages.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { MessageSnippetRow } from './messages.types';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

const baseRow: MessageSnippetRow = {
  id: 'm1',
  title: 'Follow up',
  channel: 'email',
  body: 'Hi {{name}}',
  variables: ['name'],
  file_ids: [],
  created_by: 'u1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('listMessageSnippets', () => {
  it('delegates to the repository', async () => {
    (findMessageSnippets as jest.Mock).mockResolvedValue([baseRow]);
    await expect(listMessageSnippets({})).resolves.toEqual([baseRow]);
  });
});

describe('getMessageSnippet', () => {
  it('returns the snippet when found', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(baseRow);
    await expect(getMessageSnippet('m1')).resolves.toEqual(baseRow);
  });

  it('throws 404 when missing', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(null);
    await expect(getMessageSnippet('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createMessageSnippet', () => {
  it('inserts and audits', async () => {
    (insertMessageSnippet as jest.Mock).mockResolvedValue(baseRow);
    const result = await createMessageSnippet(
      { title: 'Follow up', body: 'Hi {{name}}', channel: 'email' },
      actor,
    );
    expect(result).toEqual(baseRow);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message_snippet.created' }),
    );
  });
});

describe('updateMessageSnippet', () => {
  it('throws 404 when missing', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(null);
    await expect(updateMessageSnippet('missing', { title: 'x' }, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('updates and audits', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(baseRow);
    (updateMessageSnippetRepo as jest.Mock).mockResolvedValue({ ...baseRow, title: 'Renamed' });
    const result = await updateMessageSnippet('m1', { title: 'Renamed' }, actor);
    expect(result.title).toBe('Renamed');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message_snippet.updated' }),
    );
  });
});

describe('removeMessageSnippet', () => {
  it('throws 404 when missing', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(null);
    await expect(removeMessageSnippet('missing', actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('soft-deletes and audits', async () => {
    (findMessageSnippetById as jest.Mock).mockResolvedValue(baseRow);
    await removeMessageSnippet('m1', actor);
    expect(softDeleteMessageSnippet).toHaveBeenCalledWith('m1');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message_snippet.deleted' }),
    );
  });
});
