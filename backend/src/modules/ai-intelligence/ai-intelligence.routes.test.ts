import request from 'supertest';
import express from 'express';
import aiIntelligenceRoutes from './ai-intelligence.routes';
import * as service from './ai-intelligence.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { LeadAiProfileRow, AiDecisionLogRow } from './ai-intelligence.types';

jest.mock('./ai-intelligence.service');
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
    if (!req.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    next();
  }),
}));

const app = express();
app.use(express.json());
app.use('/ai-intelligence', aiIntelligenceRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const LEAD_ID = '11111111-1111-1111-1111-111111111111';

const fakeProfile: LeadAiProfileRow = {
  id: 'p-1',
  lead_id: LEAD_ID,
  website_quality_score: 60,
  pain_points: ['no online booking'],
  offer_angle: 'WhatsApp booking automation',
  inferred_budget_range: 'medium',
  buying_intent: 'high',
  reachability_score: 80,
  buying_signals: [],
  objection_log: [],
  do_not_say: [],
  preferred_channel: 'whatsapp',
  preferred_time_of_day: null,
  conversation_summary: null,
  ai_notes: 'Promising lead',
  next_best_action: 'send_whatsapp',
  next_best_action_reason: 'High intent, no prior outreach',
  next_best_action_confidence: 82,
  enrichment_status: 'done',
  last_enriched_at: '2026-06-26T10:00:00.000Z',
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

const fakeDecision: AiDecisionLogRow = {
  id: 'd-1',
  lead_id: LEAD_ID,
  campaign_id: null,
  decision_type: 'research',
  input_context: {},
  chain_of_thought: 'Context → Options → Reasoning → Decision → Confidence',
  decision: 'send_whatsapp',
  confidence: 82,
  tokens_used: 500,
  latency_ms: 1200,
  model_used: 'gpt-4o',
  autonomy_level: 'guarded',
  human_approval_required: false,
  human_approved_by: null,
  human_approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('AI Intelligence Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /ai-intelligence/leads/:leadId/profile', () => {
    it('returns 200 with the profile', async () => {
      mockedService.getAiProfile.mockResolvedValue(fakeProfile);

      const res = await request(app).get(`/ai-intelligence/leads/${LEAD_ID}/profile`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lead_id).toBe(LEAD_ID);
    });

    it('returns 404 when no profile exists', async () => {
      mockedService.getAiProfile.mockResolvedValue(null);

      const res = await request(app).get(`/ai-intelligence/leads/${LEAD_ID}/profile`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for a non-uuid leadId', async () => {
      const res = await request(app).get('/ai-intelligence/leads/not-a-uuid/profile');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /ai-intelligence/leads/:leadId/decisions', () => {
    it('returns 200 with paginated decisions', async () => {
      mockedService.getLeadDecisions.mockResolvedValue({ items: [fakeDecision], total: 1 });

      const res = await request(app).get(`/ai-intelligence/leads/${LEAD_ID}/decisions`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('GET /ai-intelligence/decisions (admin audit)', () => {
    it('returns 200 for admin', async () => {
      mockedService.getDecisions.mockResolvedValue({ items: [fakeDecision], total: 1 });

      const res = await request(app).get('/ai-intelligence/decisions?decision_type=research');

      expect(res.status).toBe(200);
      expect(mockedService.getDecisions).toHaveBeenCalledWith(
        expect.objectContaining({ decisionType: 'research' }),
      );
    });

    it('returns 400 for an invalid decision_type', async () => {
      const res = await request(app).get('/ai-intelligence/decisions?decision_type=bogus');
      expect(res.status).toBe(400);
    });

    it('returns 403 for a non-admin role', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, _res: any, next: any) => {
          req.user = { id: 'u-2', role: 'sales' };
          next();
        },
      }));
      const { default: routesAsSales } = await import('./ai-intelligence.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/ai-intelligence', routesAsSales);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/ai-intelligence/decisions');

      expect(res.status).toBe(403);
    });
  });
});
