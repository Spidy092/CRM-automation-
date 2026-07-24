jest.mock('./pages.controller', () => ({
  listPagesHandler: jest.fn(),
  getPageHandler: jest.fn(),
  getPageViewsHandler: jest.fn(),
  createPageHandler: jest.fn(),
  updatePageHandler: jest.fn(),
  publishPageHandler: jest.fn(),
  unpublishPageHandler: jest.fn(),
  deletePageHandler: jest.fn(),
  getPublicPageHandler: jest.fn(),
}));

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', role: 'admin' };
    next();
  }),
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req: any, _res: any, next: any) => next(),
  publicLimiter: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { pagesRoutes } from './pages.routes';
import * as controller from './pages.controller';

const app = express();
app.use(express.json());
app.use('/pages', pagesRoutes);

beforeEach(() => jest.clearAllMocks());

describe('pages routes — admin', () => {
  it('GET /pages/admin calls listPagesHandler', async () => {
    (controller.listPagesHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/pages/admin').expect(200);
    expect(controller.listPagesHandler).toHaveBeenCalled();
  });

  it('GET /pages/admin/:id calls getPageHandler', async () => {
    (controller.getPageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/pages/admin/p1').expect(200);
    expect(controller.getPageHandler).toHaveBeenCalled();
  });

  it('GET /pages/admin/:id/views calls getPageViewsHandler', async () => {
    (controller.getPageViewsHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: { total: 0, recent: [] } });
    });
    await request(app).get('/pages/admin/p1/views').expect(200);
    expect(controller.getPageViewsHandler).toHaveBeenCalled();
  });

  it('POST /pages/admin calls createPageHandler', async () => {
    (controller.createPageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/pages/admin').send({}).expect(201);
    expect(controller.createPageHandler).toHaveBeenCalled();
  });

  it('PUT /pages/admin/:id calls updatePageHandler', async () => {
    (controller.updatePageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/pages/admin/p1').send({}).expect(200);
    expect(controller.updatePageHandler).toHaveBeenCalled();
  });

  it('POST /pages/admin/:id/publish calls publishPageHandler', async () => {
    (controller.publishPageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/pages/admin/p1/publish').expect(200);
    expect(controller.publishPageHandler).toHaveBeenCalled();
  });

  it('POST /pages/admin/:id/unpublish calls unpublishPageHandler', async () => {
    (controller.unpublishPageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/pages/admin/p1/unpublish').expect(200);
    expect(controller.unpublishPageHandler).toHaveBeenCalled();
  });

  it('DELETE /pages/admin/:id calls deletePageHandler', async () => {
    (controller.deletePageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).delete('/pages/admin/p1').expect(200);
    expect(controller.deletePageHandler).toHaveBeenCalled();
  });
});

describe('pages routes — public', () => {
  it('GET /pages/:slug calls getPublicPageHandler without authentication', async () => {
    (controller.getPublicPageHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/pages/welcome').expect(200);
    expect(controller.getPublicPageHandler).toHaveBeenCalled();
  });
});
