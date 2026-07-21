import request from 'supertest';
import express from 'express';
import { newsletterRoutes } from './newsletter.routes';
import * as service from './newsletter.service';

jest.mock('./newsletter.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
  publicLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    const role = req.headers['x-test-role'] ?? 'admin';
    req.user = { id: 'admin-1', role };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: 'Forbidden' });
    next();
  }),
}));

import { errorHandler } from '../../shared/middleware/errorHandler';
import { AppError } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/newsletter', newsletterRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const baseRow = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'lead@example.com',
  status: 'pending' as const,
  topics: ['promotions'],
  frequency: 'weekly' as const,
  unsubscribe_token_hash: 'should-never-leak',
  source: 'website',
  confirmed_at: null,
  unsubscribed_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

describe('Newsletter Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /newsletter/subscribe returns 201 with a generic message', async () => {
    mockedService.subscribe.mockResolvedValue({ ok: true, value: { message: 'Thanks!' } });
    const res = await request(app).post('/newsletter/subscribe').send({ email: 'lead@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ message: 'Thanks!' });
    expect(mockedService.subscribe).toHaveBeenCalledWith('lead@example.com', [], 'weekly', 'website');
  });

  it('POST /newsletter/subscribe returns 422 for an invalid email', async () => {
    const res = await request(app).post('/newsletter/subscribe').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    expect(mockedService.subscribe).not.toHaveBeenCalled();
  });

  it('GET /newsletter/confirm confirms with a valid token', async () => {
    mockedService.confirmSubscription.mockResolvedValue({ ok: true, value: { message: 'Subscription confirmed.' } });
    const res = await request(app).get('/newsletter/confirm?token=raw-token');
    expect(res.status).toBe(200);
    expect(mockedService.confirmSubscription).toHaveBeenCalledWith('raw-token');
  });

  it('GET /newsletter/confirm returns 400 for an invalid token', async () => {
    mockedService.confirmSubscription.mockResolvedValue({
      ok: false,
      error: new AppError('Invalid or expired confirmation token', 400),
    });
    const res = await request(app).get('/newsletter/confirm?token=bad-token');
    expect(res.status).toBe(400);
  });

  it('GET /newsletter/unsubscribe unsubscribes with a valid token', async () => {
    mockedService.unsubscribe.mockResolvedValue({ ok: true, value: { message: 'You have been unsubscribed.' } });
    const res = await request(app).get('/newsletter/unsubscribe?token=raw-token');
    expect(res.status).toBe(200);
  });

  it('GET /newsletter/preferences returns current preferences', async () => {
    mockedService.getPreferences.mockResolvedValue({
      ok: true,
      value: { topics: ['promotions'], frequency: 'weekly', status: 'confirmed' },
    });
    const res = await request(app).get('/newsletter/preferences?token=raw-token');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ topics: ['promotions'], frequency: 'weekly', status: 'confirmed' });
  });

  it('PATCH /newsletter/preferences updates and never leaks the unsubscribe token hash', async () => {
    mockedService.updateSubscriberPreferences.mockResolvedValue({ ok: true, value: baseRow });
    const res = await request(app)
      .patch('/newsletter/preferences?token=raw-token')
      .send({ frequency: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body.data.unsubscribe_token_hash).toBeUndefined();
  });

  it('PATCH /newsletter/preferences returns 422 when no fields are provided', async () => {
    const res = await request(app).patch('/newsletter/preferences?token=raw-token').send({});
    expect(res.status).toBe(422);
    expect(mockedService.updateSubscriberPreferences).not.toHaveBeenCalled();
  });

  it('GET /newsletter/admin/subscribers returns 200 for an admin', async () => {
    mockedService.listSubscribers.mockResolvedValue({
      ok: true,
      value: { items: [baseRow], meta: { limit: 25, offset: 0, total: 1 } },
    });
    const res = await request(app).get('/newsletter/admin/subscribers');
    expect(res.status).toBe(200);
    expect(res.body.data[0].unsubscribe_token_hash).toBeUndefined();
    expect(res.body.meta).toEqual({ limit: 25, offset: 0, total: 1 });
  });

  it('GET /newsletter/admin/subscribers/:id returns a single subscriber', async () => {
    mockedService.getSubscriberById.mockResolvedValue({ ok: true, value: baseRow });
    const res = await request(app).get(`/newsletter/admin/subscribers/${baseRow.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(baseRow.id);
  });

  it('GET /newsletter/admin/subscribers/:id returns 404 when not found', async () => {
    mockedService.getSubscriberById.mockResolvedValue({
      ok: false,
      error: new AppError('Subscriber not found', 404),
    });
    const res = await request(app).get('/newsletter/admin/subscribers/550e8400-e29b-41d4-a716-446655440099');
    expect(res.status).toBe(404);
  });

  it('GET /newsletter/admin/subscribers returns 403 for a role outside admin/marketing', async () => {
    const res = await request(app)
      .get('/newsletter/admin/subscribers')
      .set('x-test-role', 'sales');
    expect(res.status).toBe(403);
    expect(mockedService.listSubscribers).not.toHaveBeenCalled();
  });
});
