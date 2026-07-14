import request from 'supertest';
import express from 'express';
import { teamMetricsRoutes } from './teamMetrics.routes';
import * as service from './teamMetrics.service';

jest.mock('./teamMetrics.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'admin' };
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

const app = express();
app.use(express.json());
app.use('/team', teamMetricsRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

describe('Team Metrics Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /team/metrics returns 200 with metrics', async () => {
    mockedService.getTeamMetrics.mockResolvedValue({
      ok: true,
      value: [
        { user_id: 'admin-1', name: 'Admin', assigned_count: 3, contacted_count: 1, contacted_pct: 33.33, avg_response_time: 3600, total_activities: 2 },
      ],
    });
    const res = await request(app).get('/team/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ user_id: 'admin-1', name: 'Admin' });
  });

  it('GET /team/metrics returns 422 for invalid from date', async () => {
    const res = await request(app).get('/team/metrics?from=invalid');
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('GET /team/metrics passes query params to service', async () => {
    mockedService.getTeamMetrics.mockResolvedValue({ ok: true, value: [] });
    const stageId = '550e8400-e29b-41d4-a716-446655440000';
    await request(app).get(`/team/metrics?stage=${stageId}&from=2026-01-01T00:00:00.000Z&to=2026-01-31T23:59:59.999Z`);
    expect(mockedService.getTeamMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ stage: stageId, from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' }),
      expect.objectContaining({ id: 'admin-1', role: 'admin' }),
    );
  });
});
