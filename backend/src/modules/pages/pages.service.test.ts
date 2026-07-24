jest.mock('./pages.repository', () => ({
  findPages: jest.fn(),
  findPageById: jest.fn(),
  findPublishedPageBySlug: jest.fn(),
  findPageBySlug: jest.fn(),
  insertPage: jest.fn(),
  updatePage: jest.fn(),
  setPageStatus: jest.fn(),
  softDeletePage: jest.fn(),
  insertPageView: jest.fn(),
  findPageViews: jest.fn(),
  countPageViews: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../files/files.service', () => ({ getFile: jest.fn() }));

import {
  listPages,
  getPage,
  getPublicPage,
  recordPageView,
  getPageViews,
  createPage,
  updatePage,
  publishPage,
  unpublishPage,
  removePage,
} from './pages.service';
import {
  findPages,
  findPageById,
  findPublishedPageBySlug,
  findPageBySlug,
  insertPage,
  updatePage as updatePageRepo,
  setPageStatus,
  softDeletePage,
  insertPageView,
  findPageViews,
  countPageViews,
} from './pages.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { getFile } from '../files/files.service';
import { LandingPageRow } from './pages.types';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

const baseRow: LandingPageRow = {
  id: 'p1',
  title: 'Welcome',
  slug: 'welcome',
  description: 'Hello world',
  blocks: [{ type: 'link', label: 'Site', url: 'https://example.com' }],
  status: 'draft',
  created_by: 'u1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('listPages', () => {
  it('delegates to the repository', async () => {
    (findPages as jest.Mock).mockResolvedValue([baseRow]);
    await expect(listPages()).resolves.toEqual([baseRow]);
  });
});

describe('getPage', () => {
  it('returns the page when found', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    await expect(getPage('p1')).resolves.toEqual(baseRow);
  });

  it('throws 404 when missing', async () => {
    (findPageById as jest.Mock).mockResolvedValue(null);
    await expect(getPage('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getPublicPage', () => {
  it('returns title/slug/description/blocks and an empty file map when no blocks reference files', async () => {
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(baseRow);
    await expect(getPublicPage('welcome')).resolves.toEqual({
      title: 'Welcome',
      slug: 'welcome',
      description: 'Hello world',
      blocks: baseRow.blocks,
      files: {},
    });
    expect(getFile).not.toHaveBeenCalled();
  });

  it('resolves gallery and attachment fileIds into a files map', async () => {
    const withFileBlocks: LandingPageRow = {
      ...baseRow,
      blocks: [
        { type: 'gallery', fileIds: ['f1', 'f2'] },
        { type: 'attachment', fileId: 'f3', label: 'Brochure' },
      ],
    };
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(withFileBlocks);
    (getFile as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve({
        id,
        filename: `${id}.png`,
        mime_type: 'image/png',
        url: `http://x/${id}.png`,
      }),
    );

    const result = await getPublicPage('welcome');

    expect(result.files).toEqual({
      f1: { url: 'http://x/f1.png', filename: 'f1.png', mimeType: 'image/png' },
      f2: { url: 'http://x/f2.png', filename: 'f2.png', mimeType: 'image/png' },
      f3: { url: 'http://x/f3.png', filename: 'f3.png', mimeType: 'image/png' },
    });
  });

  it('omits a file from the map (without failing) when its lookup rejects', async () => {
    const withMissingFile: LandingPageRow = {
      ...baseRow,
      blocks: [{ type: 'attachment', fileId: 'gone', label: 'Old file' }],
    };
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(withMissingFile);
    (getFile as jest.Mock).mockRejectedValue(new Error('File not found'));

    const result = await getPublicPage('welcome');
    expect(result.files).toEqual({});
  });

  it('throws 404 for a draft or missing slug', async () => {
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(null);
    await expect(getPublicPage('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('recordPageView', () => {
  it('no-ops when the slug does not resolve to a published page', async () => {
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(null);
    await expect(
      recordPageView('missing', { leadId: null, ipAddress: null, userAgent: null }),
    ).resolves.toBeUndefined();
    expect(insertPageView).not.toHaveBeenCalled();
  });

  it('logs a view against the resolved page id', async () => {
    (findPublishedPageBySlug as jest.Mock).mockResolvedValue(baseRow);
    await recordPageView('welcome', { leadId: 'lead-1', ipAddress: '1.2.3.4', userAgent: 'jest' });
    expect(insertPageView).toHaveBeenCalledWith({
      page_id: 'p1',
      lead_id: 'lead-1',
      ip_address: '1.2.3.4',
      user_agent: 'jest',
    });
  });
});

describe('getPageViews', () => {
  it('throws 404 when the page is missing', async () => {
    (findPageById as jest.Mock).mockResolvedValue(null);
    await expect(getPageViews('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns total and recent views', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    (countPageViews as jest.Mock).mockResolvedValue(5);
    (findPageViews as jest.Mock).mockResolvedValue([{ id: 'v1' }]);
    await expect(getPageViews('p1')).resolves.toEqual({ total: 5, recent: [{ id: 'v1' }] });
  });
});

describe('createPage', () => {
  it('rejects a duplicate slug', async () => {
    (findPageBySlug as jest.Mock).mockResolvedValue(baseRow);
    await expect(
      createPage({ title: 'X', slug: 'welcome', description: 'Y', blocks: [] }, actor),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(insertPage).not.toHaveBeenCalled();
  });

  it('inserts and audits when slug is free', async () => {
    (findPageBySlug as jest.Mock).mockResolvedValue(null);
    (insertPage as jest.Mock).mockResolvedValue(baseRow);
    const result = await createPage(
      { title: 'Welcome', slug: 'welcome', description: 'Hello world', blocks: baseRow.blocks },
      actor,
    );
    expect(result).toEqual(baseRow);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'page.created' }));
  });
});

describe('updatePage', () => {
  it('throws 404 when missing', async () => {
    (findPageById as jest.Mock).mockResolvedValue(null);
    await expect(updatePage('missing', { title: 'x' }, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects a slug change to one already in use', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    (findPageBySlug as jest.Mock).mockResolvedValue({ ...baseRow, id: 'other' });
    await expect(updatePage('p1', { slug: 'taken' }, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('updates and audits', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    (updatePageRepo as jest.Mock).mockResolvedValue({ ...baseRow, title: 'Renamed' });
    const result = await updatePage('p1', { title: 'Renamed' }, actor);
    expect(result.title).toBe('Renamed');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'page.updated' }));
  });
});

describe('publishPage / unpublishPage', () => {
  it('publishPage throws 404 when missing', async () => {
    (findPageById as jest.Mock).mockResolvedValue(null);
    await expect(publishPage('missing', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('publishPage sets status and audits', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    (setPageStatus as jest.Mock).mockResolvedValue({ ...baseRow, status: 'published' });
    const result = await publishPage('p1', actor);
    expect(result.status).toBe('published');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'page.published' }));
  });

  it('unpublishPage sets status and audits', async () => {
    (findPageById as jest.Mock).mockResolvedValue({ ...baseRow, status: 'published' });
    (setPageStatus as jest.Mock).mockResolvedValue(baseRow);
    const result = await unpublishPage('p1', actor);
    expect(result.status).toBe('draft');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'page.unpublished' }),
    );
  });
});

describe('removePage', () => {
  it('throws 404 when missing', async () => {
    (findPageById as jest.Mock).mockResolvedValue(null);
    await expect(removePage('missing', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('soft-deletes and audits', async () => {
    (findPageById as jest.Mock).mockResolvedValue(baseRow);
    await removePage('p1', actor);
    expect(softDeletePage).toHaveBeenCalledWith('p1');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'page.deleted' }));
  });
});
