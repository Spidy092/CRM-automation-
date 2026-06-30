import express from 'express';
import request from 'supertest';
import { integrationsRoutes } from './integrations.routes';
import * as integrationsService from './integrations.service';
import { errorHandler } from '../../shared/middleware/errorHandler';

jest.mock('./integrations.service');

let currentUser: { id: string; role: string } | null = { id: 'u1', role: 'admin' };

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!currentUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = currentUser;
    next();
  },
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    next();
  }),
}));

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req: any, _res: any, next: any) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api/v1/integrations', integrationsRoutes);
app.use(errorHandler);

const mockBulkResult = {
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  results: [
    {
      id: 'int-1',
      name: 'openwa',
      ok: true,
      status: 'ok',
      message: 'OpenWA session healthy (42ms).',
      tested_at: '2026-06-27T00:00:00.000Z',
    },
    {
      id: 'int-2',
      name: 'sendgrid',
      ok: false,
      status: 'no_credentials',
      message: 'No credentials configured for this integration',
      tested_at: '2026-06-27T00:00:00.000Z',
    },
  ],
};

describe('integrations routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = { id: 'u1', role: 'admin' };
  });

  describe('GET /api/v1/integrations', () => {
    it('returns 200 with a list of integrations', async () => {
      (integrationsService.listIntegrations as jest.Mock).mockResolvedValue([
        {
          id: 'int-1',
          name: 'openwa',
          display_name: 'OpenWA',
          is_enabled: true,
          last_tested_at: null,
          last_test_status: null,
          updated_by: null,
          updated_at: '2026-06-27T00:00:00.000Z',
        },
      ]);

      const res = await request(app).get('/api/v1/integrations');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('int-1');
      expect(integrationsService.listIntegrations).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/v1/integrations/test-all', () => {
    it('returns 200 with success envelope', async () => {
      (integrationsService.testAllIntegrations as jest.Mock).mockResolvedValue(mockBulkResult);

      const res = await request(app).post('/api/v1/integrations/test-all');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockBulkResult);
      expect(integrationsService.testAllIntegrations).toHaveBeenCalledTimes(1);
      expect(integrationsService.testAllIntegrations).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1' }),
      );
    });

    it('requires authentication', async () => {
      currentUser = null;

      const res = await request(app).post('/api/v1/integrations/test-all');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(integrationsService.testAllIntegrations).not.toHaveBeenCalled();
    });

    it.each(['admin', 'manager', 'marketing'])('allows the %s role', async (role) => {
      currentUser = { id: 'u1', role };
      (integrationsService.testAllIntegrations as jest.Mock).mockResolvedValue(mockBulkResult);

      const res = await request(app).post('/api/v1/integrations/test-all');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(integrationsService.testAllIntegrations).toHaveBeenCalledTimes(1);
    });

    it.each(['sales', 'viewer'])('rejects the %s role', async (role) => {
      currentUser = { id: 'u1', role };

      const res = await request(app).post('/api/v1/integrations/test-all');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(integrationsService.testAllIntegrations).not.toHaveBeenCalled();
    });

    it('handles service errors via the error handler', async () => {
      (integrationsService.testAllIntegrations as jest.Mock).mockRejectedValue(new Error('boom'));

      const res = await request(app).post('/api/v1/integrations/test-all');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
