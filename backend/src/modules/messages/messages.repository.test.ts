jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findMessageSnippets,
  findMessageSnippetById,
  insertMessageSnippet,
  updateMessageSnippet,
  softDeleteMessageSnippet,
} from './messages.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findMessageSnippets', () => {
  it('returns all non-deleted snippets with no filters', async () => {
    mockQuery.mockResolvedValue([{ id: 'm1' }]);
    const result = await findMessageSnippets({});
    expect(result).toEqual([{ id: 'm1' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), []);
  });

  it('applies channel filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findMessageSnippets({ channel: 'email' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('channel ='), ['email']);
  });

  it('applies search filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findMessageSnippets({ search: 'follow up' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), ['%follow up%']);
  });
});

describe('findMessageSnippetById', () => {
  it('returns the row when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'm1' });
    await expect(findMessageSnippetById('m1')).resolves.toEqual({ id: 'm1' });
  });

  it('returns null when missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(findMessageSnippetById('missing')).resolves.toBeNull();
  });
});

describe('insertMessageSnippet', () => {
  it('inserts and returns the row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'm1' });
    const result = await insertMessageSnippet({
      title: 'Follow up',
      channel: 'email',
      body: 'Hi there',
      variables: [],
      file_ids: [],
      created_by: 'u1',
    });
    expect(result).toEqual({ id: 'm1' });
  });

  it('throws 500 when insert returns no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      insertMessageSnippet({
        title: 'Follow up',
        channel: null,
        body: 'Hi',
        variables: [],
        file_ids: [],
        created_by: 'u1',
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('updateMessageSnippet', () => {
  it('updates specified fields', async () => {
    mockQueryOne.mockResolvedValue({ id: 'm1', title: 'Renamed' });
    const result = await updateMessageSnippet('m1', { title: 'Renamed' });
    expect(result).toEqual({ id: 'm1', title: 'Renamed' });
  });

  it('throws 404 when no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateMessageSnippet('missing', { title: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('softDeleteMessageSnippet', () => {
  it('soft-deletes without error when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'm1' });
    await expect(softDeleteMessageSnippet('m1')).resolves.toBeUndefined();
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(softDeleteMessageSnippet('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
