import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { formsRoutes } from './forms.routes';

jest.mock('./forms.controller', () => ({
  listFormsHandler: jest.fn((req, res) => res.json({ ok: true })),
  getFormHandler: jest.fn((req, res) => res.json({ ok: true })),
  createFormHandler: jest.fn((req, res) => res.json({ ok: true })),
  updateFormHandler: jest.fn((req, res) => res.json({ ok: true })),
  deleteFormHandler: jest.fn((req, res) => res.json({ ok: true })),
  getFormAnalyticsHandler: jest.fn((req, res) => res.json({ ok: true })),
  getEmbedSnippetHandler: jest.fn((req, res) => res.json({ ok: true })),
  getPublicFormHandler: jest.fn((req, res) => res.json({ ok: true })),
  submitFormHandler: jest.fn((req, res) => res.json({ ok: true })),
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn((..._roles: string[]) => (req: Request, res: Response, next: NextFunction) => next()),
}));
import { authorize } from '../../shared/middleware/rbac';
const mockAuthorize = authorize as unknown as jest.Mock;

let authenticateShouldFail = false;
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (authenticateShouldFail) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.user = { id: 'u1', role: 'admin', email: 'a@b.com', name: 'Admin' };
    next();
  },
}));
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  publicLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));

const app = express();
app.use(express.json());
app.use('/forms', formsRoutes);

beforeEach(() => {
  authenticateShouldFail = false;
});

describe('forms.routes public endpoints', () => {
  it('GET /:slug does not require authentication', async () => {
    const res = await request(app).get('/forms/contact-us');
    expect(res.status).toBe(200);
  });

  it('POST /:formId/submit does not require authentication', async () => {
    const res = await request(app).post('/forms/f1/submit').send({ email: 'a@b.com' });
    expect(res.status).toBe(200);
  });
});

describe('forms.routes admin endpoints', () => {
  it('GET /admin requires authentication', async () => {
    authenticateShouldFail = true;
    const res = await request(app).get('/forms/admin');
    expect(res.status).toBe(401);
  });

  it('GET /admin passes through auth + rbac when authenticated', async () => {
    const res = await request(app).get('/forms/admin');
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith('admin', 'manager', 'marketing');
  });

  it('DELETE /admin/:formId restricts to admin/manager (not marketing)', async () => {
    const res = await request(app).delete('/forms/admin/f1');
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith('admin', 'manager');
  });

  it('GET /admin/:formId/analytics is authenticated and role-checked', async () => {
    const res = await request(app).get('/forms/admin/f1/analytics');
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith('admin', 'manager', 'marketing');
  });
});
