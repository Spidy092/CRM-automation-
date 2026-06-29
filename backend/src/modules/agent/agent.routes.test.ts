import request from 'supertest';
import express from 'express';
import agentRoutes from './agent.routes';
import * as service from './agent.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { AgentActionRow } from './agent.types';

jest.mock('./agent.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin', email: 'admin@example.com' };
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

const app = express();
app.use(express.json());
app.use('/agent', agentRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const baseRow: AgentActionRow = {
  id: 'action-1',
  source: 'chat',
  action_name: 'lead.list',
  action_args: {},
  risk_tier: 'read',
  status: 'proposed',
  requested_by: 'user-1',
  requester_role: 'admin',
  requester_email: 'admin@example.com',
  requester_name: 'Admin',
  approved_by: null,
  lead_id: null,
  campaign_id: null,
  confidence: null,
  autonomy_level: null,
  idempotency_key: 'agent:abc',
  result: null,
  error_message: null,
  source_message: null,
  expires_at: null,
  executed_at: null,
  created_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Agent Routes', () => {
  describe('POST /agent/actions (propose)', () => {
    it('returns 200 when policy outcome is execute_now', async () => {
      mockedService.proposeAgentAction.mockResolvedValue({
        policy: { outcome: 'execute_now', reason: 'low risk' },
        action: baseRow,
      });

      const res = await request(app)
        .post('/agent/actions')
        .send({ source: 'chat', actionName: 'lead.list', args: {}, actor: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.policy.outcome).toBe('execute_now');
    });

    it('returns 202 when policy outcome is require_approval', async () => {
      const pendingRow: AgentActionRow = { ...baseRow, status: 'pending_approval' };
      mockedService.proposeAgentAction.mockResolvedValue({
        policy: { outcome: 'require_approval', reason: 'sensitive write', assignTo: 'manager-1' },
        action: pendingRow,
      });

      const res = await request(app)
        .post('/agent/actions')
        .send({ source: 'chat', actionName: 'campaign.launch', args: { id: '11111111-1111-4111-8111-111111111111' }, actor: null });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid action name', async () => {
      const res = await request(app)
        .post('/agent/actions')
        .send({ source: 'chat', actionName: 'not.a.real.action', args: {}, actor: null });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /agent/actions/:id/execute', () => {
    it('returns 200 on success', async () => {
      const executedRow: AgentActionRow = { ...baseRow, status: 'succeeded' };
      mockedService.executeAgentAction.mockResolvedValue(executedRow);

      const res = await request(app).post('/agent/actions/action-1/execute');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('succeeded');
      expect(mockedService.executeAgentAction).toHaveBeenCalledWith(
        'action-1',
        expect.objectContaining({ approvedBy: 'user-1' }),
      );
    });

    it('returns 404 when action not found', async () => {
      const { AppError } = await import('../../shared/middleware/errorHandler');
      mockedService.executeAgentAction.mockRejectedValue(new AppError('Agent action not found', 404));

      const res = await request(app).post('/agent/actions/missing/execute');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /agent/actions/:id/reject', () => {
    it('returns 200 on reject', async () => {
      const rejectedRow: AgentActionRow = { ...baseRow, status: 'rejected' };
      mockedService.rejectAgentAction.mockResolvedValue(rejectedRow);

      const res = await request(app).post('/agent/actions/action-1/reject');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');
      expect(mockedService.rejectAgentAction).toHaveBeenCalledWith('action-1', 'user-1');
    });
  });

  describe('RBAC enforcement', () => {
    it('returns 403 for an unauthorized role', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          req.user = { id: 'guest-1', role: 'guest' };
          next();
        },
      }));
      const { default: routesWithGuest } = await import('./agent.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/agent', routesWithGuest);
      testApp.use(errorHandler);

      const res = await request(testApp).post('/agent/actions/action-1/execute');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('returns 401 when unauthenticated', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        },
      }));
      const { default: routesWithNoAuth } = await import('./agent.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/agent', routesWithNoAuth);
      testApp.use(errorHandler);

      const res = await request(testApp).post('/agent/actions/action-1/execute');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });
  });
});
