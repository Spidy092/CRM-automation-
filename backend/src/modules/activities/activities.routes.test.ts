import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { activitiesRoutes } from './activities.routes';
import * as service from './activities.service';

jest.mock('./activities.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    req.user = { id: 'user-1', role: 'sales', email: 'sales@example.com', name: 'Sales User' };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn(
    (...roles: string[]) => (req: Request, res: Response, next: NextFunction): void | Response => {
      if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
      if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: 'Forbidden' });
      next();
    },
  ),
}));

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/:leadId/activities', activitiesRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

describe('Activities Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /:leadId/activities returns 200 with paginated activities', async () => {
    mockedService.listActivities.mockResolvedValue({
      items: [
        {
          id: 'act-1',
          lead_id: 'lead-1',
          user_id: 'user-1',
          type: 'note',
          metadata: { note: 'hello' },
          created_at: '2026-06-19T00:00:00.000Z',
          user_name: 'User One',
          user_email: 'user1@example.com',
        },
      ],
      meta: { total: 1, limit: 25, offset: 0 },
    });
    const res = await request(app).get('/lead-1/activities');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: 'act-1', type: 'note' });
  });

  it('GET /:leadId/activities passes query filters to service', async () => {
    mockedService.listActivities.mockResolvedValue({
      items: [],
      meta: { total: 0, limit: 10, offset: 5 },
    });
    await request(app).get('/lead-1/activities?limit=10&offset=5&type=call');
    expect(mockedService.listActivities).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ id: 'user-1', role: 'sales' }),
      { limit: 10, offset: 5, type: 'call' },
    );
  });

  it('POST /:leadId/activities creates an activity', async () => {
    mockedService.createManualActivity.mockResolvedValue({
      id: 'act-2',
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'note',
      metadata: { note: 'follow up' },
      created_at: '2026-06-19T00:00:00.000Z',
    });
    const res = await request(app).post('/lead-1/activities').send({ type: 'note', metadata: { note: 'follow up' } });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ type: 'note' });
    expect(mockedService.createManualActivity).toHaveBeenCalledWith('lead-1', 'user-1', 'note', { note: 'follow up' });
  });

  it('POST /:leadId/activities returns 422 for invalid type', async () => {
    const res = await request(app).post('/lead-1/activities').send({ type: 'invalid' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('GET /:leadId/activities handles service errors', async () => {
    mockedService.listActivities.mockRejectedValue(new Error('db error'));
    const res = await request(app).get('/lead-1/activities');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
