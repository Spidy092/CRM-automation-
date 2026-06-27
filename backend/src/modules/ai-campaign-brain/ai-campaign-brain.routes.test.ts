import request from 'supertest';
import express from 'express';
import aiCampaignBrainRoutes from './ai-campaign-brain.routes';
import * as service from './ai-campaign-brain.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { CampaignBrief } from './ai-campaign-brain.types';

jest.mock('./ai-campaign-brain.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'mgr-1', role: 'manager' };
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
app.use('/ai-campaign-brain', aiCampaignBrainRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const CAMPAIGN_ID = '22222222-2222-2222-2222-222222222222';

const fakeBrief: CampaignBrief = {
  id: 'b-1',
  campaign_id: CAMPAIGN_ID,
  total_leads_evaluated: 188,
  eligible_leads: 150,
  high_fit_leads: 42,
  segment_summary: '188 local service businesses',
  recommended_offer_angle: 'WhatsApp booking automation',
  expected_objections: ['too expensive'],
  risk_warnings: ['8 may be competitors'],
  recommended_sequence: [],
  template_suggestions: [],
  recommended_autonomy_level: 'guarded',
  confidence_score: 78,
  status: 'draft',
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('AI Campaign Brain Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /campaigns/:campaignId/brief', () => {
    it('returns 200 with the brief', async () => {
      mockedService.getCampaignBrief.mockResolvedValue(fakeBrief);

      const res = await request(app).get(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief`);

      expect(res.status).toBe(200);
      expect(res.body.data.campaign_id).toBe(CAMPAIGN_ID);
    });

    it('returns 404 when no brief exists', async () => {
      mockedService.getCampaignBrief.mockResolvedValue(null);

      const res = await request(app).get(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief`);

      expect(res.status).toBe(404);
    });

    it('returns 400 for a non-uuid campaignId', async () => {
      const res = await request(app).get('/ai-campaign-brain/campaigns/nope/brief');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /campaigns/:campaignId/brief/approve', () => {
    it('returns 200 and approved brief', async () => {
      mockedService.approveCampaignBrief.mockResolvedValue({ ...fakeBrief, status: 'approved', approved_by: 'mgr-1' });

      const res = await request(app).post(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief/approve`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('approved');
      expect(mockedService.approveCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_ID, 'mgr-1');
    });

    it('returns 404 when service reports not found', async () => {
      mockedService.approveCampaignBrief.mockRejectedValue(new Error('Campaign brief not found: x'));

      const res = await request(app).post(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief/approve`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /campaigns/:campaignId/brief/reject', () => {
    it('returns 200 and rejected brief', async () => {
      mockedService.rejectCampaignBrief.mockResolvedValue({ ...fakeBrief, status: 'rejected' });

      const res = await request(app).post(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief/reject`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('rejected');
    });
  });

  describe('RBAC', () => {
    it('returns 403 for sales attempting approve', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, _res: any, next: any) => {
          req.user = { id: 's-1', role: 'sales' };
          next();
        },
      }));
      const { default: routesAsSales } = await import('./ai-campaign-brain.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/ai-campaign-brain', routesAsSales);
      testApp.use(errorHandler);

      const res = await request(testApp).post(`/ai-campaign-brain/campaigns/${CAMPAIGN_ID}/brief/approve`);

      expect(res.status).toBe(403);
    });
  });
});
