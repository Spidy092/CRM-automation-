import request from 'supertest';
import express from 'express';
import { assignmentsRoutes } from './assignments.routes';
import * as assignmentsService from './assignments.service';

jest.mock('./assignments.service');

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
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => next(),
}));

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/assignments', assignmentsRoutes);
app.use(errorHandler);

describe('Assignments Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /assignments/config', () => {
    it('returns 200 and config', async () => {
      (assignmentsService.getConfig as jest.Mock).mockResolvedValue({
        id: 'config-1',
        is_enabled: true,
      });

      const res = await request(app).get('/assignments/config');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('config-1');
    });
  });

  describe('PUT /assignments/config', () => {
    it('returns 200 on successful update', async () => {
      (assignmentsService.updateConfig as jest.Mock).mockResolvedValue({
        id: 'config-1',
        is_enabled: false,
      });

      const res = await request(app)
        .put('/assignments/config')
        .send({ is_enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.data.is_enabled).toBe(false);
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .put('/assignments/config')
        .send({ threshold_score: 150 }); // max is 100

      expect(res.status).toBe(422);
    });
  });

  describe('GET /assignments/eligible-users', () => {
    it('returns 200 and eligible users list', async () => {
      (assignmentsService.getEligibleUsers as jest.Mock).mockResolvedValue([
        { id: 'user-1' },
      ]);

      const res = await request(app).get('/assignments/eligible-users');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe('user-1');
    });
  });

  describe('POST /assignments/manual', () => {
    it('returns 201 on manual assignment', async () => {
      (assignmentsService.assignManually as jest.Mock).mockResolvedValue({
        id: 'assignment-1',
      });

      const res = await request(app)
        .post('/assignments/manual')
        .send({ lead_id: '550e8400-e29b-41d4-a716-446655440000', user_id: '550e8400-e29b-41d4-a716-446655440001' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('assignment-1');
    });

    it('returns 422 if missing uuid', async () => {
      const res = await request(app)
        .post('/assignments/manual')
        .send({ lead_id: 'not-a-uuid', user_id: '550e8400-e29b-41d4-a716-446655440001' });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /assignments/override', () => {
    it('returns 200 on override', async () => {
      (assignmentsService.overrideAssignment as jest.Mock).mockResolvedValue({
        id: 'override-1',
      });

      const res = await request(app)
        .post('/assignments/override')
        .send({ lead_id: '550e8400-e29b-41d4-a716-446655440000', new_user_id: '550e8400-e29b-41d4-a716-446655440001', reason: 'User requested' });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('override-1');
    });
  });

  describe('GET /assignments/user/:userId', () => {
    it('returns 200 and assignments', async () => {
      (assignmentsService.getUserAssignments as jest.Mock).mockResolvedValue([
        { id: 'assignment-1' },
      ]);

      const res = await request(app).get('/assignments/user/550e8400-e29b-41d4-a716-446655440001');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe('assignment-1');
    });
  });
});
