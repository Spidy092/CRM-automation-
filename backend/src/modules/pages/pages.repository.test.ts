jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findPages,
  findPageById,
  findPublishedPageBySlug,
  findPageBySlug,
  insertPage,
  updatePage,
  setPageStatus,
  softDeletePage,
  insertPageView,
  findPageViews,
  countPageViews,
} from './pages.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findPages', () => {
  it('returns non-deleted pages', async () => {
    mockQuery.mockResolvedValue([{ id: 'p1' }]);
    await expect(findPages()).resolves.toEqual([{ id: 'p1' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'));
  });
});

describe('findPageById', () => {
  it('returns the row when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1' });
    await expect(findPageById('p1')).resolves.toEqual({ id: 'p1' });
  });

  it('returns null when missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(findPageById('missing')).resolves.toBeNull();
  });
});

describe('findPublishedPageBySlug', () => {
  it('filters by published status', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1', status: 'published' });
    await findPublishedPageBySlug('welcome');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("status = 'published'"), [
      'welcome',
    ]);
  });
});

describe('findPageBySlug', () => {
  it('looks up regardless of status', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1' });
    await expect(findPageBySlug('welcome')).resolves.toEqual({ id: 'p1' });
  });
});

describe('insertPage', () => {
  it('inserts blocks as jsonb and returns the row', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1' });
    const result = await insertPage({
      title: 'Welcome',
      slug: 'welcome',
      description: 'Hello',
      blocks: [{ type: 'link', label: 'Site', url: 'https://example.com' }],
      created_by: 'u1',
    });
    expect(result).toEqual({ id: 'p1' });
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('$4::jsonb'),
      expect.arrayContaining([JSON.stringify([{ type: 'link', label: 'Site', url: 'https://example.com' }])]),
    );
  });

  it('throws 500 when insert returns no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      insertPage({ title: 'X', slug: 'x', description: null, blocks: [], created_by: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('updatePage', () => {
  it('updates specified fields including blocks', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1', title: 'Renamed' });
    const result = await updatePage('p1', {
      title: 'Renamed',
      blocks: [{ type: 'video', youtubeUrl: 'https://youtu.be/abc' }],
    });
    expect(result).toEqual({ id: 'p1', title: 'Renamed' });
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('blocks = $2::jsonb'), [
      'Renamed',
      JSON.stringify([{ type: 'video', youtubeUrl: 'https://youtu.be/abc' }]),
      'p1',
    ]);
  });

  it('throws 404 when no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updatePage('missing', { title: 'x' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('setPageStatus', () => {
  it('updates status', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1', status: 'published' });
    const result = await setPageStatus('p1', 'published');
    expect(result.status).toBe('published');
  });

  it('throws 404 when no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(setPageStatus('missing', 'published')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('softDeletePage', () => {
  it('resolves when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'p1' });
    await expect(softDeletePage('p1')).resolves.toBeUndefined();
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(softDeletePage('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('insertPageView', () => {
  it('inserts a view row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await insertPageView({
      page_id: 'p1',
      lead_id: 'lead-1',
      ip_address: '1.2.3.4',
      user_agent: 'jest',
    });
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO landing_page_views'),
      ['p1', 'lead-1', '1.2.3.4', 'jest'],
    );
  });
});

describe('findPageViews', () => {
  it('returns recent views for a page', async () => {
    mockQuery.mockResolvedValue([{ id: 'v1' }]);
    await expect(findPageViews('p1')).resolves.toEqual([{ id: 'v1' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE page_id = $1'), ['p1', 50]);
  });
});

describe('countPageViews', () => {
  it('returns the parsed count', async () => {
    mockQueryOne.mockResolvedValue({ count: '3' });
    await expect(countPageViews('p1')).resolves.toBe(3);
  });

  it('returns 0 when no row', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(countPageViews('p1')).resolves.toBe(0);
  });
});
