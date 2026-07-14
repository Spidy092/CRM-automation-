import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  listReportsHandler,
  getDashboardHandler,
  getLeadGenerationReportHandler,
  getOutreachReportHandler,
  getPipelineReportHandler,
  getSalesRepReportHandler,
  getCampaignAnalyticsReportHandler,
  getIntegrationHealthReportHandler,
  exportReportHandler,
  downloadExportHandler,
} from './reports.controller';
import * as service from './reports.service';
import { ZodError } from 'zod';

jest.mock('./reports.service');
jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedService = service as jest.Mocked<typeof service>;

function mockReq(options: { query?: Record<string, unknown>; body?: Record<string, unknown>; user?: { id: string; role: string } } = {}): Partial<Request> {
  return {
    query: options.query || {},
    body: options.body || {},
    user: options.user || { id: 'admin-1', role: 'admin' },
    ip: '127.0.0.1',
  } as unknown as Request;
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const mockNext = jest.fn() as NextFunction;

describe('reports.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listReportsHandler', () => {
    it('returns 200 with paginated reports', async () => {
      mockedService.listReports.mockResolvedValue({
        items: [{ id: 'r1', name: 'Report 1', type: 'leads', description: '', createdAt: '' }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq({ query: { limit: '25', offset: '0' } });
      const res = mockRes() as Response;

      await listReportsHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          meta: expect.any(Object),
        }),
      );
    });

    it('returns 200 with default pagination', async () => {
      mockedService.listReports.mockResolvedValue({
        items: [],
        meta: { limit: 25, offset: 0, total: 4 },
      });

      const req = mockReq();
      const res = mockRes() as Response;

      await listReportsHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes validation errors to next', async () => {
      const req = mockReq({ query: { limit: 'not-a-number' } });
      const res = mockRes() as Response;

      await listReportsHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      const err = (mockNext as jest.Mock).mock.calls[0][0];
      expect(err).toBeInstanceOf(ZodError);
    });
  });

  describe('getDashboardHandler', () => {
    it('returns 200 with dashboard metrics', async () => {
      const metrics = {
        totalLeads: 10,
        qualifiedLeads: 5,
        totalCampaigns: 2,
        activeOutreach: 3,
        pipelineConversion: 25,
        recentActivity: [],
      };
      mockedService.getDashboardMetrics.mockResolvedValue(metrics);

      const req = mockReq({ user: { id: 'admin-1', role: 'admin' } });
      const res = mockRes() as Response;

      await getDashboardHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: metrics,
        }),
      );
      expect(mockedService.getDashboardMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'admin-1', role: 'admin' }),
      );
    });

    it('passes errors to next', async () => {
      const error = new Error('db error');
      mockedService.getDashboardMetrics.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes() as Response;

      await getDashboardHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getLeadGenerationReportHandler', () => {
    it('returns 200 with lead report', async () => {
      mockedService.getLeadGenerationReport.mockResolvedValue({
        items: [{ date: '2026-06-20', source: 'fb', count: 5 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq({ query: { startDate: '2026-06-01', endDate: '2026-06-30' } });
      const res = mockRes() as Response;

      await getLeadGenerationReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          meta: expect.any(Object),
        }),
      );
    });

    it('passes validation errors to next', async () => {
      const req = mockReq({ query: { limit: '-1' } });
      const res = mockRes() as Response;

      await getLeadGenerationReportHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('getOutreachReportHandler', () => {
    it('returns 200 with outreach report', async () => {
      mockedService.getOutreachReport.mockResolvedValue({
        items: [{ date: '2026-06-20', channel: 'email', sent: 10, delivered: 8, opened: 4, replied: 2, failed: 0 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq();
      const res = mockRes() as Response;

      await getOutreachReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getPipelineReportHandler', () => {
    it('returns 200 with pipeline report', async () => {
      mockedService.getPipelineReport.mockResolvedValue({
        items: [{ stageName: 'proposal', leadCount: 5, conversionRate: 20, avgDays: 3 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq();
      const res = mockRes() as Response;

      await getPipelineReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getSalesRepReportHandler', () => {
    it('returns 200 with sales rep report', async () => {
      mockedService.getSalesRepReport.mockResolvedValue({
        items: [{ repId: 'u1', repName: 'Alice', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 0 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq();
      const res = mockRes() as Response;

      await getSalesRepReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('exportReportHandler', () => {
    it('returns 202 with job info', async () => {
      mockedService.enqueueExportJob.mockResolvedValue({ jobId: 'job-123', status: 'queued' });

      const req = mockReq({ body: { reportType: 'leads', format: 'csv' } });
      const res = mockRes() as Response;

      await exportReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: { jobId: 'job-123', status: 'queued' },
        }),
      );
      expect(mockedService.enqueueExportJob).toHaveBeenCalledWith(
        expect.objectContaining({ reportType: 'leads', format: 'csv' }),
        expect.objectContaining({ id: 'admin-1', role: 'admin' }),
      );
    });

    it('passes filters when provided', async () => {
      mockedService.enqueueExportJob.mockResolvedValue({ jobId: 'job-456', status: 'queued' });

      const req = mockReq({ body: { reportType: 'leads', format: 'xlsx', filters: { startDate: '2026-06-01' } } });
      const res = mockRes() as Response;

      await exportReportHandler(req as Request, res, mockNext);

      expect(mockedService.enqueueExportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          reportType: 'leads',
          format: 'xlsx',
          filters: { startDate: '2026-06-01' },
        }),
        expect.anything(),
      );
    });

    it('returns validation error for invalid body', async () => {
      const req = mockReq({ body: { reportType: '', format: 'csv' } });
      const res = mockRes() as Response;

      await exportReportHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });
  });

  describe('getCampaignAnalyticsReportHandler', () => {
    it('returns 200 with campaign analytics', async () => {
      mockedService.getCampaignAnalyticsReport.mockResolvedValue({
        items: [{ date: '2026-06-20', campaignId: 'camp-1', campaignName: 'Summer Promo', channel: 'email', leadsTargeted: 10, leadsConverted: 2, conversionRate: 0.2 }],
        meta: { limit: 25, offset: 0, total: 1 },
      });

      const req = mockReq({ query: { startDate: '2026-06-01', endDate: '2026-06-30' } });
      const res = mockRes() as Response;

      await getCampaignAnalyticsReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
          meta: expect.any(Object),
        }),
      );
    });

    it('passes validation errors to next', async () => {
      const req = mockReq({ query: { limit: '-1' } });
      const res = mockRes() as Response;

      await getCampaignAnalyticsReportHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(ZodError);
    });

    it('passes service errors to next', async () => {
      const error = new Error('service error');
      mockedService.getCampaignAnalyticsReport.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes() as Response;

      await getCampaignAnalyticsReportHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('getIntegrationHealthReportHandler', () => {
    it('returns 200 with integration health rows', async () => {
      mockedService.getIntegrationHealthReport.mockResolvedValue([
        { integrationId: 'int-1', name: 'twilio', displayName: 'Twilio', channel: 'sms', status: 'healthy', enabled: true, successRate: 95, lastTestedAt: new Date().toISOString() },
      ]);

      const req = mockReq();
      const res = mockRes() as Response;

      await getIntegrationHealthReportHandler(req as Request, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
        }),
      );
    });

    it('passes service errors to next', async () => {
      const error = new Error('service error');
      mockedService.getIntegrationHealthReport.mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes() as Response;

      await getIntegrationHealthReportHandler(req as Request, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('downloadExportHandler', () => {
    const tmpDir = '/tmp/crm-test-exports';
    const fs = require('fs');
    const path = require('path');

    beforeEach(() => {
      jest.clearAllMocks();
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    function mockDownloadRes(): Partial<Response> {
      const res: Partial<Response> = {};
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      res.download = jest.fn().mockImplementation((_path: string, _filename: string, cb: (err?: Error) => void) => {
        cb();
      });
      return res;
    }

    it('downloads an existing export file', () => {
      jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      const exportsDir = path.join(tmpDir, 'exports');
      fs.mkdirSync(exportsDir, { recursive: true });
      fs.writeFileSync(path.join(exportsDir, 'job-123-export.csv'), 'a,b,c');

      const req = { params: { jobId: 'job-123' }, ip: '127.0.0.1', user: { id: 'admin-1', role: 'admin' } } as unknown as Request;
      const res = mockDownloadRes() as Response;

      downloadExportHandler(req, res, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(res.download).toHaveBeenCalledWith(
        expect.stringContaining('job-123-export.csv'),
        'job-123-export.csv',
        expect.any(Function),
      );
    });

    it('rejects invalid job id format', () => {
      jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      const req = { params: { jobId: 'job-123/../../etc/passwd' }, ip: '127.0.0.1', user: { id: 'admin-1', role: 'admin' } } as unknown as Request;
      const res = mockDownloadRes() as Response;

      downloadExportHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(AppError);
    });

    it('returns 404 when exports directory is missing', () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/tmp/no-such-crm-dir');
      const req = { params: { jobId: 'job-123' }, ip: '127.0.0.1', user: { id: 'admin-1', role: 'admin' } } as unknown as Request;
      const res = mockDownloadRes() as Response;

      downloadExportHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(AppError);
    });

    it('returns 404 when no file matches the job id', () => {
      jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      const req = { params: { jobId: 'job-missing' }, ip: '127.0.0.1', user: { id: 'admin-1', role: 'admin' } } as unknown as Request;
      const res = mockDownloadRes() as Response;

      downloadExportHandler(req, res, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockNext as jest.Mock).mock.calls[0][0]).toBeInstanceOf(AppError);
    });
  });
});
