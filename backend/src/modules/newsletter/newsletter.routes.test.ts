import request from 'supertest';
import express from 'express';
import { newsletterRoutes } from './newsletter.routes';
import * as service from './newsletter.service';

jest.mock('./newsletter.service');
jest.mock('./newsletter.drafts.service', () => ({
  list: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  send: jest.fn(),
}));
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
import * as drafts from './newsletter.drafts.service';

const app = express();
app.use(express.json());
app.use('/newsletter', newsletterRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;
const mockedDrafts = drafts as jest.Mocked<typeof drafts>;

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

  it('POST /newsletter/unsubscribe unsubscribes with a valid token', async () => {
    mockedService.unsubscribe.mockResolvedValue({ ok: true, value: { message: 'You have been unsubscribed.' } });
    const res = await request(app).post('/newsletter/unsubscribe?token=raw-token');
    expect(res.status).toBe(200);
    expect(mockedService.unsubscribe).toHaveBeenCalledWith('raw-token');
  });

  it('hands legacy GET unsubscribe links to the confirmation UI without changing subscription state', async () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://crm.example.test';
    try {
      const res = await request(app).get('/newsletter/unsubscribe?token=raw-token');
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(
        'https://crm.example.test/newsletter/unsubscribe?token=raw-token',
      );
      expect(mockedService.unsubscribe).not.toHaveBeenCalled();
    } finally {
      if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontendUrl;
    }
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

  it('PATCH /newsletter/admin/subscribers/:id/preferences updates topics and frequency without leaking token data', async () => {
    mockedService.updateSubscriberPreferencesById.mockResolvedValue({
      ok: true,
      value: { ...baseRow, topics: ['company_news'], frequency: 'monthly' },
    });
    const res = await request(app)
      .patch(`/newsletter/admin/subscribers/${baseRow.id}/preferences`)
      .send({ topics: ['company_news'], frequency: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.data.topics).toEqual(['company_news']);
    expect(res.body.data.unsubscribe_token_hash).toBeUndefined();
    expect(mockedService.updateSubscriberPreferencesById).toHaveBeenCalledWith(baseRow.id, {
      topics: ['company_news'],
      frequency: 'monthly',
    });
  });

  it('PATCH /newsletter/admin/subscribers/:id/preferences rejects roles outside admin/marketing', async () => {
    const res = await request(app)
      .patch(`/newsletter/admin/subscribers/${baseRow.id}/preferences`)
      .set('x-test-role', 'sales')
      .send({ topics: ['company_news'] });

    expect(res.status).toBe(403);
    expect(mockedService.updateSubscriberPreferencesById).not.toHaveBeenCalled();
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

  it('GET /newsletter/admin/subscribers/:id rejects a malformed UUID before calling the service', async () => {
    const res = await request(app).get('/newsletter/admin/subscribers/not-a-uuid');
    expect(res.status).toBe(422);
    expect(mockedService.getSubscriberById).not.toHaveBeenCalled();
  });

  it('PATCH /newsletter/admin/subscribers/:id/preferences propagates a missing subscriber error', async () => {
    mockedService.updateSubscriberPreferencesById.mockResolvedValue({
      ok: false,
      error: new AppError('Subscriber not found', 404),
    });
    const res = await request(app)
      .patch(`/newsletter/admin/subscribers/${baseRow.id}/preferences`)
      .send({ frequency: 'monthly' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Subscriber not found');
  });

  it('GET /newsletter/admin/subscribers returns 403 for a role outside admin/marketing', async () => {
    const res = await request(app)
      .get('/newsletter/admin/subscribers')
      .set('x-test-role', 'sales');
    expect(res.status).toBe(403);
    expect(mockedService.listSubscribers).not.toHaveBeenCalled();
  });

  it('GET /newsletter/admin/subscribers/counts returns audience-wide counts', async () => {
    mockedService.getSubscriberCounts.mockResolvedValue({
      ok: true,
      value: { pending: 1, confirmed: 2, unsubscribed: 0, total: 3 },
    });
    const res = await request(app).get('/newsletter/admin/subscribers/counts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ pending: 1, confirmed: 2, unsubscribed: 0, total: 3 });
  });

  it('GET /newsletter/admin/subscribers/export downloads CSV with exact total header', async () => {
    mockedService.exportSubscribersCsv.mockResolvedValue({
      ok: true,
      value: { csv: 'email,status\n"=cmd",confirmed', total: 1 },
    });
    const res = await request(app).get('/newsletter/admin/subscribers/export?status=confirmed');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('newsletter-subscribers.csv');
    expect(res.headers['x-newsletter-export-total']).toBe('1');
    expect(mockedService.exportSubscribersCsv).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    );
  });

  it('GET /newsletter/admin/eligible-count returns eligible recipients', async () => {
    mockedService.getEligibleRecipientCount.mockResolvedValue({ ok: true, value: { eligible: 4, total: 4, pending: 0, unsubscribed: 0, topicMismatch: 0, frequencyMismatch: 0, waiting: 0, reserved: 0, nextEligibleAt: null } });
    const res = await request(app).get('/newsletter/admin/eligible-count?frequency=weekly');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ eligible: 4, total: 4, waiting: 0 });
  });

  it('POST /newsletter/admin/test-send requires an explicit address', async () => {
    const res = await request(app)
      .post('/newsletter/admin/test-send')
      .send({ to: 'not-an-email', subject: 'S', htmlBody: '<p>B</p>' });
    expect(res.status).toBe(422);
    expect(mockedService.sendNewsletterTest).not.toHaveBeenCalled();
  });

  it('GET /newsletter/admin/digest-status returns persisted schedule/timezone/outcome', async () => {
    mockedService.getDigestStatus.mockResolvedValue({
      ok: true,
      value: {
        enabled: true,
        schedule: '0 9 * * 5 (Fridays 09:00)',
        timezone: 'Asia/Kolkata',
        nextRunAt: null,
        autoSend: false,
        lastOutcome: { status: 'never_run', message: 'none', at: null },
      },
    });
    const res = await request(app).get('/newsletter/admin/digest-status');
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe('Asia/Kolkata');
  });

  it('GET /newsletter/admin/broadcasts returns history without invented delivery metrics', async () => {
    mockedService.listBroadcastHistory.mockResolvedValue({ ok: true, value: { items: [] } });
    const res = await request(app).get('/newsletter/admin/broadcasts');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('POST /newsletter/admin/broadcast keeps backwards-compatible { subject, htmlBody }', async () => {
    mockedService.triggerBroadcast.mockResolvedValue({ ok: true, value: { enqueued: true } });
    const res = await request(app)
      .post('/newsletter/admin/broadcast')
      .send({ subject: 'S', htmlBody: '<p>B</p>' });
    expect(res.status).toBe(202);
    expect(mockedService.triggerBroadcast).toHaveBeenCalledWith(
      'S',
      '<p>B</p>',
      expect.objectContaining({ subject: 'S', htmlBody: '<p>B</p>' }),
      { id: 'admin-1' },
    );
  });

  it('POST /newsletter/admin/broadcasts/:id/retry-failed enqueues a targeted retry', async () => {
    mockedService.retryFailedRecipients.mockResolvedValue({
      ok: true,
      value: { enqueued: true, retrying: 2 },
    });
    const res = await request(app).post('/newsletter/admin/broadcasts/550e8400-e29b-41d4-a716-446655440000/retry-failed');
    expect(res.status).toBe(202);
    expect(mockedService.retryFailedRecipients).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      { id: 'admin-1' },
      { includeUncertain: false },
    );
  });

  it('POST /newsletter/admin/broadcasts/:id/retry-failed forwards explicit uncertain opt-in', async () => {
    mockedService.retryFailedRecipients.mockResolvedValue({
      ok: true,
      value: { enqueued: true, retrying: 2, retryingUncertain: 1 },
    });
    const res = await request(app)
      .post('/newsletter/admin/broadcasts/550e8400-e29b-41d4-a716-446655440000/retry-failed')
      .send({ includeUncertain: true });
    expect(res.status).toBe(202);
    expect(mockedService.retryFailedRecipients).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      { id: 'admin-1' },
      { includeUncertain: true },
    );
  });

  it('POST /newsletter/admin/broadcasts/:id/retry-failed returns 404 when content is gone', async () => {
    mockedService.retryFailedRecipients.mockResolvedValue({
      ok: false,
      error: new AppError('Original broadcast content is no longer available for retry', 404),
    });
    const res = await request(app).post('/newsletter/admin/broadcasts/job-xyz/retry-failed');
    expect(res.status).toBe(404);
  });

  it('GET /newsletter/admin/broadcasts/:id/uncertain-recipients lists review ids', async () => {
    mockedService.listUncertainRecipients.mockResolvedValue({
      ok: true,
      value: { items: [{ subscriberId: 'sub-u1', email: 'u1@example.com' }] },
    });
    const res = await request(app).get(
      '/newsletter/admin/broadcasts/550e8400-e29b-41d4-a716-446655440000/uncertain-recipients',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ subscriberId: 'sub-u1', email: 'u1@example.com' }]);
  });
});

describe('admin direct enrollment', () => {
  beforeEach(() => jest.clearAllMocks());
  it('validates selected lead IDs and supplies defaults and actor', async () => {
    mockedService.addNewsletterContacts.mockResolvedValue({ ok: true, value: { added: 1, failed: 0, skipped: 0, failedLeadIds: [] } });
    const res = await request(app).post('/newsletter/admin/contacts').send({ leadIds: [baseRow.id] });
    expect(res.status).toBe(200);
    expect(mockedService.addNewsletterContacts).toHaveBeenCalledWith({ leadIds: [baseRow.id], topics: ['product_updates', 'promotions', 'company_news'], frequency: 'weekly' }, { id: 'admin-1', role: 'admin' });
  });
  it('rejects bad IDs before service calls', async () => {
    const res = await request(app).post('/newsletter/admin/contacts').send({ leadIds: ['bad'] });
    expect(res.status).toBe(422);
    expect(mockedService.addNewsletterContacts).not.toHaveBeenCalled();
  });
  it('denies marketing access to lead enrollment', async () => {
    const res = await request(app).post('/newsletter/admin/contacts').set('x-test-role', 'marketing').send({ leadIds: [baseRow.id] });
    expect(res.status).toBe(403);
    expect(mockedService.addNewsletterContacts).not.toHaveBeenCalled();
  });
});

describe('admin newsletter drafts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists drafts for admin and marketing roles', async () => {
    mockedDrafts.list.mockResolvedValue({ ok: true, value: [] });
    const res = await request(app).get('/newsletter/admin/drafts?limit=10&offset=0')
      .set('x-test-role', 'marketing');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(mockedDrafts.list).toHaveBeenCalledWith(10, 0);
  });

  it('creates a draft and attributes it to the authenticated actor', async () => {
    const content = { subject: '', htmlBody: '', timezone: 'Asia/Kolkata' };
    mockedDrafts.save.mockResolvedValue({ ok: true, value: { id: baseRow.id, content, revision: 1 } as never });
    const res = await request(app).post('/newsletter/admin/drafts').send({ content });
    expect(res.status).toBe(201);
    expect(mockedDrafts.save).toHaveBeenCalledWith(
      expect.objectContaining({ subject: '', htmlBody: '', timezone: 'Asia/Kolkata' }),
      'admin-1',
      undefined,
      undefined,
    );
  });

  it('requires the current revision before updating a draft', async () => {
    const res = await request(app).put(`/newsletter/admin/drafts/${baseRow.id}`).send({
      content: { subject: 'Updated', htmlBody: '<p>Body</p>' },
    });
    expect(res.status).toBe(400);
    expect(mockedDrafts.save).not.toHaveBeenCalled();
  });

  it('denies sales access to draft management', async () => {
    const res = await request(app).get('/newsletter/admin/drafts').set('x-test-role', 'sales');
    expect(res.status).toBe(403);
    expect(mockedDrafts.list).not.toHaveBeenCalled();
  });
});
