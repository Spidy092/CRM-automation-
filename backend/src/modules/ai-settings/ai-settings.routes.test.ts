import request from 'supertest';
import express from 'express';
import { aiSettingsRoutes } from './ai-settings.routes';
import { errorHandler } from '../../shared/middleware/errorHandler';
import './ai-settings.schema';

jest.mock('./ai-settings.controller', () => ({
  getAiSettingsHandler: jest.fn(),
  updateAiSettingsHandler: jest.fn(),
}));

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u-1', email: 'admin@test.com', role: 'admin', name: 'Admin' };
    next();
  },
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    next();
  }),
}));

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req: any, _res: any, next: any) => next(),
}));

import * as controller from './ai-settings.controller';

const app = express();
app.use(express.json());
app.use('/api/v1/ai-settings', aiSettingsRoutes);
app.use(errorHandler);

describe('AI Settings Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/ai-settings', () => {
    it('returns 200 for authorized roles', async () => {
      (controller.getAiSettingsHandler as jest.Mock).mockImplementationOnce(
        async (_req: any, res: any) => {
          res.status(200).json({ success: true, data: { id: 's-1' } });
        },
      );

      const res = await request(app).get('/api/v1/ai-settings');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: 's-1' });
      expect(controller.getAiSettingsHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/v1/ai-settings', () => {
    it('returns 200 for admin role', async () => {
      (controller.updateAiSettingsHandler as jest.Mock).mockImplementationOnce(
        async (_req: any, res: any) => {
          res.status(200).json({ success: true, data: { id: 's-1' } });
        },
      );

      const res = await request(app).patch('/api/v1/ai-settings').send({ model: 'gpt-4o' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: 's-1' });
      expect(controller.updateAiSettingsHandler).toHaveBeenCalledTimes(1);
    });

    it('handles controller errors via error handler', async () => {
      (controller.updateAiSettingsHandler as jest.Mock).mockImplementationOnce(
        async (_req: any, _res: any, next: any) => {
          next(new Error('update failed'));
        },
      );

      const res = await request(app).patch('/api/v1/ai-settings').send({ model: 'gpt-4o' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
