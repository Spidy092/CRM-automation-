import request from 'supertest';
import express from 'express';
import aiReplyRoutes from './ai-reply.routes';
import * as service from './ai-reply.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { ReplyClassification } from './ai-reply.types';

jest.mock('./ai-reply.service', () => ({
  classifyInboundReply: jest.fn(),
  getReplyHistory: jest.fn(),
  triggerClassification: jest.fn(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
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
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    next();
  }),
}));

const app = express();
app.use(express.json());
app.use('/api/v1/ai-reply', aiReplyRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const validUuid = '019f079c-f429-762a-89ab-d143218efd4e';
const classification: ReplyClassification = {
  intent_class: 'interested',
  intent_subtype: 'high',
  confidence: 92,
  draft_response: 'Great, let us schedule a call.',
  next_best_action: 'schedule_call',
  update_stage_to: null,
  objection_type: null,
  buying_signal: 'asked for pricing',
  chain_of_thought: 'The lead is interested.',
  should_stop_sequence: false,
  requires_human_review: false,
};

describe('AI Reply Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/ai-reply/classify', () => {
    it('returns 200 for an authorized role', async () => {
      mockedService.classifyInboundReply.mockResolvedValueOnce(classification);

      const res = await request(app).post('/api/v1/ai-reply/classify').send({
        lead_id: validUuid,
        message: 'I am interested.',
        channel: 'email',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(classification);
      expect(mockedService.classifyInboundReply).toHaveBeenCalledWith({
        leadId: validUuid,
        channel: 'email',
        messageText: 'I am interested.',
        externalMessageId: undefined,
      });
    });

    it('returns 401 when authentication is missing', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (_req: any, res: any, _next: any) => {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        },
      }));

      const { default: routesWithNoAuth } = await import('./ai-reply.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/api/v1/ai-reply', routesWithNoAuth);
      testApp.use(errorHandler);

      const res = await request(testApp).post('/api/v1/ai-reply/classify').send({
        lead_id: validUuid,
        message: 'I am interested.',
        channel: 'email',
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });
  });

  describe('GET /api/v1/ai-reply/history', () => {
    it('returns 200 with paginated history', async () => {
      const items = [
        { id: 'd1', lead_id: validUuid, decision: 'interested', confidence: 90 },
      ];
      mockedService.getReplyHistory.mockResolvedValueOnce({ items, total: 1 });

      const res = await request(app)
        .get('/api/v1/ai-reply/history')
        .query({ lead_id: validUuid, limit: '10', offset: '0' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(items);
      expect(res.body.meta).toEqual({ total: 1, limit: 10, offset: 0 });
      expect(mockedService.getReplyHistory).toHaveBeenCalledWith({
        leadId: validUuid,
        campaignId: undefined,
        classification: undefined,
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('POST /api/v1/ai-reply/trigger/:leadId', () => {
    it('returns 202 when the classification is queued', async () => {
      mockedService.triggerClassification.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .post(`/api/v1/ai-reply/trigger/${validUuid}`)
        .send({ message: 'Can you tell me more?', channel: 'email' });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ accepted: true });
      expect(mockedService.triggerClassification).toHaveBeenCalledWith({
        leadId: validUuid,
        channel: 'email',
        messageText: 'Can you tell me more?',
        externalMessageId: undefined,
      });
    });
  });
});
