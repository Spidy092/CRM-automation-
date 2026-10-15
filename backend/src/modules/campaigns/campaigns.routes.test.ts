import request from 'supertest';
import express from 'express';
import { campaignsRoutes } from './campaigns.routes';
import * as campaignsService from './campaigns.service';
import * as operationsService from './campaigns.operations.service';

jest.mock('./campaigns.service');
jest.mock('./campaigns.operations.service');

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

  describe('GET /campaigns/enrollment-options', () => {
    it('returns available options before the campaign id route', async () => {
      (campaignsService.getCampaignEnrollmentOptions as jest.Mock).mockResolvedValue({ sources: ['facebook'], tags: ['vip'] });
      const res = await request(app).get('/campaigns/enrollment-options');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ sources: ['facebook'], tags: ['vip'] });
      expect(campaignsService.getCampaignById).not.toHaveBeenCalled();
    });
    it('rejects unexpected query inputs', async () => {
      const res = await request(app).get('/campaigns/enrollment-options?source=raw');
      expect(res.status).toBe(422);
      expect(campaignsService.getCampaignEnrollmentOptions).not.toHaveBeenCalled();
    });
    it('forwards errors', async () => {
      (campaignsService.getCampaignEnrollmentOptions as jest.Mock).mockRejectedValue(new Error('unavailable'));
      const res = await request(app).get('/campaigns/enrollment-options');
      expect(res.status).toBe(500);
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
    it('returns 200 on pause with operational counts in meta', async () => {
      (campaignsService.pauseCampaignById as jest.Mock).mockResolvedValue({
        campaign: { id: 'campaign-1', status: 'paused' },
        operations: { frozen: 2, inFlight: 1, cancelledJobs: 3, durable: true },
      });

      const res = await request(app).post('/campaigns/campaign-1/pause');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paused');
      expect(res.body.meta.operations).toMatchObject({ frozen: 2, inFlight: 1 });
    });
  });

  describe('POST /campaigns/:id/resume', () => {
    it('returns 200 on resume with restoration counts in meta', async () => {
      (campaignsService.resumeCampaignById as jest.Mock).mockResolvedValue({
        campaign: { id: 'campaign-1', status: 'running' },
        operations: { restored: 2, unknownTiming: 1, durable: true },
      });

      const res = await request(app).post('/campaigns/campaign-1/resume');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('running');
      expect(res.body.meta.operations).toMatchObject({ restored: 2, unknownTiming: 1 });
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

  describe('GET /campaigns/operations-summary', () => {
    const ids = '550e8400-e29b-41d4-a716-446655440000,550e8400-e29b-41d4-a716-446655440001';
    it('returns one summary row per campaign from a single request', async () => {
      (operationsService.getCampaignsSummary as jest.Mock).mockResolvedValue([
        { campaignId: 'c1', scheduled: 2, failed: 0, uncertain: 0, nextDueAt: null },
      ]);

      const res = await request(app).get(`/campaigns/operations-summary?ids=${ids}`);

      expect(res.status).toBe(200);
      expect(operationsService.getCampaignsSummary).toHaveBeenCalledWith(
        expect.arrayContaining(['550e8400-e29b-41d4-a716-446655440000']),
        expect.anything(),
      );
      // The literal path must win over the ':id' route.
      expect(campaignsService.getCampaignById).not.toHaveBeenCalled();
    });

    it('rejects invalid ids without touching the service', async () => {
      const res = await request(app).get('/campaigns/operations-summary?ids=not-a-uuid');

      expect(res.status).toBe(422);
      expect(operationsService.getCampaignsSummary).not.toHaveBeenCalled();
    });
  });

  describe('GET /campaigns/:id/operations', () => {
    it('returns the operations overview', async () => {
      (operationsService.getCampaignOperations as jest.Mock).mockResolvedValue({
        campaignId: 'campaign-1',
        nextActivity: null,
      });

      const res = await request(app).get('/campaigns/550e8400-e29b-41d4-a716-446655440000/operations');

      expect(res.status).toBe(200);
      expect(res.body.data.campaignId).toBe('campaign-1');
    });

    it('rejects non-UUID campaign ids', async () => {
      const res = await request(app).get('/campaigns/nope/operations');

      expect(res.status).toBe(422);
      expect(operationsService.getCampaignOperations).not.toHaveBeenCalled();
    });
  });

  describe('GET /campaigns/:id/schedule', () => {
    it('returns committed and projected work', async () => {
      (operationsService.getCampaignSchedule as jest.Mock).mockResolvedValue({
        committed: [],
        projected: [],
        meta: { limit: 25 },
      });

      const res = await request(app).get(
        '/campaigns/550e8400-e29b-41d4-a716-446655440000/schedule?limit=10',
      );

      expect(res.status).toBe(200);
      expect(operationsService.getCampaignSchedule).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        expect.anything(),
        expect.objectContaining({ limit: 10 }),
      );
    });
  });

  describe('GET /campaigns/:id/activity', () => {
    it('returns paged activity with cursor meta', async () => {
      (operationsService.getCampaignActivity as jest.Mock).mockResolvedValue({
        items: [],
        meta: { hasMore: false, nextCursor: null },
      });

      const res = await request(app).get('/campaigns/550e8400-e29b-41d4-a716-446655440000/activity');

      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ hasMore: false });
    });
  });

  describe('GET /campaigns/:id/enrollments', () => {
    it('keeps the legacy array endpoint untouched while serving the paged one', async () => {
      (operationsService.getCampaignEnrollments as jest.Mock).mockResolvedValue({
        items: [{ leadId: 'lead-1' }],
        meta: { hasMore: false, nextCursor: null },
      });

      const res = await request(app).get(
        '/campaigns/550e8400-e29b-41d4-a716-446655440000/enrollments?limit=10&enrollmentStatus=active',
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);

      (campaignsService.getCampaignLeads as jest.Mock).mockResolvedValue(['lead-1']);
      const legacy = await request(app).get('/campaigns/campaign-1/leads');
      expect(legacy.status).toBe(200);
      expect(legacy.body.data[0]).toBe('lead-1');
    });

    it('rejects unknown enrollment statuses', async () => {
      const res = await request(app).get(
        '/campaigns/550e8400-e29b-41d4-a716-446655440000/enrollments?enrollmentStatus=bogus',
      );

      expect(res.status).toBe(422);
      expect(operationsService.getCampaignEnrollments).not.toHaveBeenCalled();
    });
  });

  describe('POST /campaigns/:id/enrollments/:leadId/pause|resume', () => {
    const leadId = '550e8400-e29b-41d4-a716-446655440001';
    it('pauses an enrollment with an optimistic version', async () => {
      (operationsService.pauseCampaignEnrollment as jest.Mock).mockResolvedValue('paused');

      const res = await request(app)
        .post(`/campaigns/550e8400-e29b-41d4-a716-446655440000/enrollments/${leadId}/pause`)
        .send({ expectedGeneration: 2, reason: 'rep request' });

      expect(res.status).toBe(200);
      expect(res.body.data.enrollmentStatus).toBe('paused');
    });

    it('rejects pause bodies without a version', async () => {
      const res = await request(app)
        .post(`/campaigns/550e8400-e29b-41d4-a716-446655440000/enrollments/${leadId}/pause`)
        .send({});

      expect(res.status).toBe(422);
      expect(operationsService.pauseCampaignEnrollment).not.toHaveBeenCalled();
    });

    it('resumes an enrollment with an optional explicit schedule', async () => {
      (operationsService.resumeCampaignEnrollment as jest.Mock).mockResolvedValue({
        status: 'active',
        nextDueAt: '2026-10-20T09:00:00.000Z',
      });

      const res = await request(app)
        .post(`/campaigns/550e8400-e29b-41d4-a716-446655440000/enrollments/${leadId}/resume`)
        .send({ expectedGeneration: 3, nextDueAt: '2026-10-20T09:00:00.000Z' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });
  });
});
