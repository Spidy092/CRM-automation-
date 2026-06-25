import request from 'supertest';
import express from 'express';
import { reportsRoutes } from './reports.routes';
import * as service from './reports.service';

jest.mock('./reports.service');
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

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/reports', reportsRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

describe('Reports Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /reports', () => {
    it('returns 200 with list of reports', async () => {
      mockedService.listReports.mockResolvedValue({
        items: [{ id: 'r1', name: 'Lead Generation Report', type: 'leads', description: '', createdAt: '' }],
        meta: { limit: 25, offset: 0, total: 4 },
      });

      const res = await request(app).get('/reports');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(4);
    });

    it('returns validation error for invalid query', async () => {
      const res = await request(app).get('/reports?limit=invalid');
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /reports/dashboard', () => {
    it('returns 200 with dashboard metrics', async () => {
      mockedService.getDashboardMetrics.mockResolvedValue({
        totalLeads: 10,
        qualifiedLeads: 5,
        totalCampaigns: 2,
        activeOutreach: 3,
        pipelineConversion: 25,
        recentActivity: [{ date: '2026-06-21', leads: 1, outreach: 1 }],
      });

      const res = await request(app).get('/reports/dashboard');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalLeads).toBe(10);
    });

    it('returns 401 when user is not authenticated', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        },
      }));

      const { reportsRoutes: routesWithNoAuth } = await import('./reports.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/reports', routesWithNoAuth);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/reports/dashboard');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /reports/leads', () => {
    it('returns 200 with lead generation report', async () => {
      mockedService.getLeadGenerationReport.mockResolvedValue({
        items: [{ date: '2026-06-20', source: 'facebook', count: 5 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const res = await request(app).get('/reports/leads?startDate=2026-06-01&endDate=2026-06-30');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].source).toBe('facebook');
    });

    it('returns 422 for invalid date params', async () => {
      const res = await request(app).get('/reports/leads?limit=-1');
      expect(res.status).toBe(422);
    });
  });

  describe('GET /reports/outreach', () => {
    it('returns 200 with outreach report', async () => {
      mockedService.getOutreachReport.mockResolvedValue({
        items: [{ date: '2026-06-20', channel: 'email', sent: 10, delivered: 8, opened: 4, replied: 2, failed: 0 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const res = await request(app).get('/reports/outreach');

      expect(res.status).toBe(200);
      expect(res.body.data[0].channel).toBe('email');
    });
  });

  describe('GET /reports/pipeline', () => {
    it('returns 200 with pipeline report', async () => {
      mockedService.getPipelineReport.mockResolvedValue({
        items: [{ stageName: 'proposal', leadCount: 5, conversionRate: 20, avgDays: 3 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const res = await request(app).get('/reports/pipeline');

      expect(res.status).toBe(200);
      expect(res.body.data[0].stageName).toBe('proposal');
    });
  });

  describe('GET /reports/reps', () => {
    it('returns 200 with sales rep report', async () => {
      mockedService.getSalesRepReport.mockResolvedValue({
        items: [{ repId: 'u1', repName: 'Alice', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 0 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const res = await request(app).get('/reports/reps');

      expect(res.status).toBe(200);
      expect(res.body.data[0].repName).toBe('Alice');
    });
  });

  describe('POST /reports/export', () => {
    it('returns 202 with job info', async () => {
      mockedService.enqueueExportJob.mockResolvedValue({ jobId: 'job-123', status: 'queued' });

      const res = await request(app)
        .post('/reports/export')
        .send({ reportType: 'leads', format: 'csv' });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.jobId).toBe('job-123');
    });

    it('returns 422 for invalid export format', async () => {
      const res = await request(app)
        .post('/reports/export')
        .send({ reportType: 'leads', format: 'invalid' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('returns 422 for missing reportType', async () => {
      const res = await request(app)
        .post('/reports/export')
        .send({ format: 'csv' });

      expect(res.status).toBe(422);
    });

    it('passes filters to service', async () => {
      mockedService.enqueueExportJob.mockResolvedValue({ jobId: 'job-456', status: 'queued' });

      const res = await request(app)
        .post('/reports/export')
        .send({ reportType: 'leads', format: 'xlsx', filters: { startDate: '2026-06-01' } });

      expect(res.status).toBe(202);
      expect(mockedService.enqueueExportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          reportType: 'leads',
          format: 'xlsx',
          filters: { startDate: '2026-06-01' },
        }),
        expect.anything(),
      );
    });
  });

  describe('RBAC enforcement', () => {
    it('allows admin access', async () => {
      mockedService.getDashboardMetrics.mockResolvedValue({
        totalLeads: 1,
        qualifiedLeads: 0,
        totalCampaigns: 0,
        activeOutreach: 0,
        pipelineConversion: 0,
        recentActivity: [],
      });

      const res = await request(app).get('/reports/dashboard');
      expect(res.status).toBe(200);
    });

    it('forbids access for unauthorized role', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          req.user = { id: 'guest-1', role: 'guest' };
          next();
        },
      }));

      const { reportsRoutes: routesWithGuest } = await import('./reports.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/reports', routesWithGuest);
      testApp.use(errorHandler);

      mockedService.getDashboardMetrics.mockResolvedValue({
        totalLeads: 1,
        qualifiedLeads: 0,
        totalCampaigns: 0,
        activeOutreach: 0,
        pipelineConversion: 0,
        recentActivity: [],
      });

      const res = await request(testApp).get('/reports/dashboard');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });
  });
});
