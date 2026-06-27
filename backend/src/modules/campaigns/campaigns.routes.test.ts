import request from 'supertest';
import express from 'express';
import { campaignsRoutes } from './campaigns.routes';
import * as campaignsService from './campaigns.service';

jest.mock('./campaigns.service');

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
app.use('/campaigns', campaignsRoutes);
app.use(errorHandler);

describe('Campaigns Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /campaigns', () => {
    it('returns 200 and list of campaigns', async () => {
      (campaignsService.getAllCampaigns as jest.Mock).mockResolvedValue({
        items: [{ id: 'campaign-1' }],
        meta: { total: 1, hasMore: false },
      });

      const res = await request(app).get('/campaigns');

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].id).toBe('campaign-1');
    });
  });

  describe('GET /campaigns/:id', () => {
    it('returns 200 and a campaign', async () => {
      (campaignsService.getCampaignById as jest.Mock).mockResolvedValue({ id: 'campaign-1' });

      const res = await request(app).get('/campaigns/campaign-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('campaign-1');
    });
  });

  describe('POST /campaigns', () => {
    it('returns 201 on create', async () => {
      (campaignsService.createCampaign as jest.Mock).mockResolvedValue({ id: 'campaign-1' });

      const res = await request(app)
        .post('/campaigns')
        .send({ name: 'Campaign 1', tone: 'formal' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('campaign-1');
    });

    it('returns 422 on validation error', async () => {
      const res = await request(app)
        .post('/campaigns')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('PUT /campaigns/:id', () => {
    it('returns 200 on update', async () => {
      (campaignsService.updateCampaignById as jest.Mock).mockResolvedValue({ id: 'campaign-1', name: 'Campaign 2' });

      const res = await request(app)
        .put('/campaigns/campaign-1')
        .send({ name: 'Campaign 2' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Campaign 2');
    });
  });

  describe('DELETE /campaigns/:id', () => {
    it('returns 204 on delete', async () => {
      (campaignsService.deleteCampaignById as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/campaigns/campaign-1');

      expect(res.status).toBe(204);
    });
  });

  describe('POST /campaigns/:id/launch', () => {
    it('returns 200 on launch', async () => {
      (campaignsService.launchCampaignById as jest.Mock).mockResolvedValue({
        campaign: { id: 'campaign-1', status: 'running' },
        automation: { enqueued: 0, skipped: 0, mockMode: false },
      });

      const res = await request(app).post('/campaigns/campaign-1/launch');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('running');
    });
  });

  describe('POST /campaigns/:id/pause', () => {
    it('returns 200 on pause', async () => {
      (campaignsService.pauseCampaignById as jest.Mock).mockResolvedValue({ id: 'campaign-1', status: 'paused' });

      const res = await request(app).post('/campaigns/campaign-1/pause');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paused');
    });
  });

  describe('POST /campaigns/:id/resume', () => {
    it('returns 200 on resume', async () => {
      (campaignsService.resumeCampaignById as jest.Mock).mockResolvedValue({ id: 'campaign-1', status: 'running' });

      const res = await request(app).post('/campaigns/campaign-1/resume');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('running');
    });
  });

  describe('POST /campaigns/:id/leads', () => {
    it('returns 200 on adding leads', async () => {
      (campaignsService.addLeads as jest.Mock).mockResolvedValue({ added: 1 });

      const res = await request(app)
        .post('/campaigns/campaign-1/leads')
        .send({ lead_ids: ['550e8400-e29b-41d4-a716-446655440000'] });

      expect(res.status).toBe(200);
      expect(res.body.data.added).toBe(1);
    });

    it('returns 422 if lead_ids is missing', async () => {
      const res = await request(app)
        .post('/campaigns/campaign-1/leads')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /campaigns/:id/leads/:leadId', () => {
    it('returns 204 on removing lead', async () => {
      (campaignsService.removeLead as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/campaigns/campaign-1/leads/lead-1');

      expect(res.status).toBe(204);
    });
  });

  describe('GET /campaigns/:id/leads', () => {
    it('returns 200 and list of leads', async () => {
      (campaignsService.getCampaignLeads as jest.Mock).mockResolvedValue(['lead-1']);

      const res = await request(app).get('/campaigns/campaign-1/leads');

      expect(res.status).toBe(200);
      expect(res.body.data[0]).toBe('lead-1');
    });
  });

  describe('GET /campaigns/:id/stats', () => {
    it('returns 200 and stats', async () => {
      (campaignsService.getStats as jest.Mock).mockResolvedValue({ total: 10, sent: 5 });

      const res = await request(app).get('/campaigns/campaign-1/stats');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(10);
    });
  });
});
