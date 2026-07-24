import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./pages.service', () => ({
  listPages: jest.fn(),
  getPage: jest.fn(),
  getPageViews: jest.fn(),
  getPublicPage: jest.fn(),
  recordPageView: jest.fn(),
  createPage: jest.fn(),
  updatePage: jest.fn(),
  publishPage: jest.fn(),
  unpublishPage: jest.fn(),
  removePage: jest.fn(),
}));

import * as pagesService from './pages.service';
import {
  listPagesHandler,
  getPageHandler,
  getPageViewsHandler,
  createPageHandler,
  updatePageHandler,
  publishPageHandler,
  unpublishPageHandler,
  deletePageHandler,
  getPublicPageHandler,
} from './pages.controller';

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'u1', role: 'admin' },
    ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (pagesService.recordPageView as jest.Mock<any>).mockResolvedValue(undefined);
});

describe('listPagesHandler', () => {
  it('returns pages', async () => {
    (pagesService.listPages as jest.Mock<any>).mockResolvedValue([{ id: 'p1' }]);
    const res = mockRes();
    await listPagesHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getPageHandler', () => {
  it('returns the page', async () => {
    (pagesService.getPage as jest.Mock<any>).mockResolvedValue({ id: 'p1' });
    const res = mockRes();
    await getPageHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getPageViewsHandler', () => {
  it('returns view stats for the page', async () => {
    (pagesService.getPageViews as jest.Mock<any>).mockResolvedValue({ total: 3, recent: [] });
    const res = mockRes();
    await getPageViewsHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createPageHandler', () => {
  it('creates a page', async () => {
    (pagesService.createPage as jest.Mock<any>).mockResolvedValue({ id: 'p1' });
    const res = mockRes();
    await createPageHandler(
      mockReq({ body: { title: 'Welcome', slug: 'welcome', description: 'Hi' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects an invalid slug', async () => {
    const res = mockRes();
    await createPageHandler(
      mockReq({ body: { title: 'Welcome', slug: 'Not A Slug!', content: 'Hi' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(pagesService.createPage).not.toHaveBeenCalled();
  });
});

describe('updatePageHandler', () => {
  it('updates a page', async () => {
    (pagesService.updatePage as jest.Mock<any>).mockResolvedValue({ id: 'p1' });
    const res = mockRes();
    await updatePageHandler(
      mockReq({ params: { id: VALID_ID }, body: { title: 'x' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('publishPageHandler / unpublishPageHandler', () => {
  it('publishes a page', async () => {
    (pagesService.publishPage as jest.Mock<any>).mockResolvedValue({ id: 'p1', status: 'published' });
    const res = mockRes();
    await publishPageHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('unpublishes a page', async () => {
    (pagesService.unpublishPage as jest.Mock<any>).mockResolvedValue({ id: 'p1', status: 'draft' });
    const res = mockRes();
    await unpublishPageHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deletePageHandler', () => {
  it('deletes a page', async () => {
    (pagesService.removePage as jest.Mock<any>).mockResolvedValue(undefined);
    const res = mockRes();
    await deletePageHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getPublicPageHandler', () => {
  it('returns the published page for a valid slug and logs a view', async () => {
    (pagesService.getPublicPage as jest.Mock<any>).mockResolvedValue({
      title: 'Welcome',
      slug: 'welcome',
      description: 'Hi',
      blocks: [],
    });
    const res = mockRes();
    await getPublicPageHandler(
      mockReq({ params: { slug: 'welcome' }, query: {}, get: () => 'jest-agent' }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(pagesService.recordPageView).toHaveBeenCalledWith('welcome', {
      leadId: null,
      ipAddress: '127.0.0.1',
      userAgent: 'jest-agent',
    });
  });

  it('passes through the lead query param to view logging', async () => {
    (pagesService.getPublicPage as jest.Mock<any>).mockResolvedValue({
      title: 'Welcome',
      slug: 'welcome',
      description: null,
      blocks: [],
    });
    const res = mockRes();
    await getPublicPageHandler(
      mockReq({
        params: { slug: 'welcome' },
        query: { lead: VALID_ID },
        get: () => undefined,
      }),
      res,
      next,
    );
    expect(pagesService.recordPageView).toHaveBeenCalledWith('welcome', {
      leadId: VALID_ID,
      ipAddress: '127.0.0.1',
      userAgent: null,
    });
  });

  it('passes through 404 for a missing/draft slug', async () => {
    (pagesService.getPublicPage as jest.Mock<any>).mockRejectedValue(
      Object.assign(new Error('Page not found'), { statusCode: 404 }),
    );
    const res = mockRes();
    await getPublicPageHandler(mockReq({ params: { slug: 'missing' } }), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
