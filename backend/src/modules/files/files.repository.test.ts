jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findFiles,
  findFileById,
  insertFile,
  updateFile,
  softDeleteFile,
} from './files.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findFiles', () => {
  it('returns all non-deleted files with no filters', async () => {
    mockQuery.mockResolvedValue([{ id: 'f1' }]);
    const result = await findFiles({});
    expect(result).toEqual([{ id: 'f1' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'), []);
  });

  it('applies tag filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findFiles({ tag: 'brochure' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ANY(tags)'), ['brochure']);
  });

  it('applies search filter', async () => {
    mockQuery.mockResolvedValue([]);
    await findFiles({ search: 'logo' });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), ['%logo%']);
  });
});

describe('findFileById', () => {
  it('returns the row when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'f1' });
    await expect(findFileById('f1')).resolves.toEqual({ id: 'f1' });
  });

  it('returns null when missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(findFileById('missing')).resolves.toBeNull();
  });
});

describe('insertFile', () => {
  it('inserts and returns the row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'f1' });
    const result = await insertFile({
      filename: 'logo.png',
      mime_type: 'image/png',
      size_bytes: 100,
      storage_path: '/tmp/logo.png',
      url: 'http://x/logo.png',
      created_by: 'u1',
    });
    expect(result).toEqual({ id: 'f1' });
  });

  it('throws 500 when insert returns no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      insertFile({
        filename: 'logo.png',
        mime_type: 'image/png',
        size_bytes: 100,
        storage_path: '/tmp/logo.png',
        url: 'http://x/logo.png',
        created_by: 'u1',
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('updateFile', () => {
  it('updates filename and tags', async () => {
    mockQueryOne.mockResolvedValue({ id: 'f1', filename: 'new.png', tags: ['a'] });
    const result = await updateFile('f1', { filename: 'new.png', tags: ['a'] });
    expect(result).toEqual({ id: 'f1', filename: 'new.png', tags: ['a'] });
  });

  it('throws 404 when no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateFile('missing', { filename: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('softDeleteFile', () => {
  it('soft-deletes and returns the row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'f1' });
    await expect(softDeleteFile('f1')).resolves.toEqual({ id: 'f1' });
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(softDeleteFile('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});
