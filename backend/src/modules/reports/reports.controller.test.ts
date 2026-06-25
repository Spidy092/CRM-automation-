import { Request, Response, NextFunction } from 'express';
import {
  listReportsHandler,
  getDashboardHandler,
  getLeadGenerationReportHandler,
  getOutreachReportHandler,
  getPipelineReportHandler,
  getSalesRepReportHandler,
  exportReportHandler,
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
});
