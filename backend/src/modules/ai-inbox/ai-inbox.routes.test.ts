import request from 'supertest';
import express from 'express';
import aiInboxRoutes from './ai-inbox.routes';
import * as service from './ai-inbox.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { AiInboxItem } from './ai-inbox.types';

jest.mock('./ai-inbox.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'u-1', role: 'admin' };
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
app.use('/ai-inbox', aiInboxRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const fakeItem: AiInboxItem = {
  id: 'i1',
  assigned_to: 'u-1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'approve_response',
  title: 'Approve this draft',
  summary: null,
  urgency_score: 80,
  ai_draft_response: 'Draft reply',
  ai_draft_confidence: 0.9,
  expires_at: null,
  status: 'pending',
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

describe('AI Inbox Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /ai-inbox', () => {
    it('returns 200 with inbox items', async () => {
      mockedService.listItems.mockResolvedValue({ items: [fakeItem], total: 1 });

      const res = await request(app).get('/ai-inbox');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('i1');
      expect(res.body.meta.total).toBe(1);
    });

    it('returns 400 for an invalid query', async () => {
      const res = await request(app).get('/ai-inbox?limit=invalid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('PATCH /ai-inbox/:id/action', () => {
    it('returns 200 on approve', async () => {
      const approved: AiInboxItem = { ...fakeItem, status: 'actioned', actioned_by: 'u-1' };
      mockedService.actionItem.mockResolvedValue(approved);

      const res = await request(app).patch('/ai-inbox/item-1/action').send({ action: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('i1');
      expect(mockedService.actionItem).toHaveBeenCalledWith('item-1', 'u-1', 'approve', undefined);
    });

    it('returns 404 when the service throws not found', async () => {
      mockedService.actionItem.mockRejectedValue(new Error('Inbox item not found: item-1'));

      const res = await request(app).patch('/ai-inbox/item-1/action').send({ action: 'approve' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
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

      const { default: routesWithGuest } = await import('./ai-inbox.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/ai-inbox', routesWithGuest);
      testApp.use(errorHandler);

      mockedService.listItems.mockResolvedValue({ items: [fakeItem], total: 1 });

      const res = await request(testApp).get('/ai-inbox');

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

      const { default: routesWithNoAuth } = await import('./ai-inbox.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/ai-inbox', routesWithNoAuth);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/ai-inbox');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });
  });
});
