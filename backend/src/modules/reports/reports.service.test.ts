import {
  listReports,
  getDashboardMetrics,
  getLeadGenerationReport,
  getOutreachReport,
  getPipelineReport,
  getSalesRepReport,
  enqueueExportJob,
} from './reports.service';
import * as repository from './reports.repository';
import * as pagination from '../../shared/utils/pagination';
import { enqueueReportExport } from '../../workers/queue';
import { writeAuditLog } from '../../shared/utils/audit';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('./reports.repository');
jest.mock('../../workers/queue', () => ({
  enqueueReportExport: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({
  writeAuditLog: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedRepo = repository as jest.Mocked<typeof repository>;
const mockedEnqueue = enqueueReportExport as jest.MockedFunction<typeof enqueueReportExport>;
const mockedAudit = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

describe('reports.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listReports', () => {
    let clampSpy: jest.SpyInstance;
    beforeEach(() => {
      clampSpy = jest.spyOn(pagination, 'clampLimit');
    });
    afterEach(() => {
      clampSpy.mockRestore();
    });

    it('returns paginated reports from repository', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({
        items: [
          { id: 'rpt-1', name: 'Report One', description: 'Report One (leads)', type: 'leads', createdAt: '2026-06-20T10:00:00.000Z' },
          { id: 'rpt-2', name: 'Report Two', description: 'Report Two (outreach)', type: 'outreach', createdAt: '2026-06-19T10:00:00.000Z' },
        ],
        total: 4,
      });

      const result = await listReports({ limit: 2, offset: 0 });
      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(4);
      expect(result.meta.limit).toBe(2);
      expect(result.meta.offset).toBe(0);
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledTimes(1);
      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'rpt-1', name: 'Report One' }),
          expect.objectContaining({ id: 'rpt-2', name: 'Report Two' }),
        ]),
      );
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledWith({ limit: 2, offset: 0 });
    });

    it('returns second page', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({
        items: [
          { id: 'rpt-3', name: 'Report Three', description: 'Report Three (pipeline)', type: 'pipeline', createdAt: '2026-06-18T10:00:00.000Z' },
          { id: 'rpt-4', name: 'Report Four', description: 'Report Four (reps)', type: 'reps', createdAt: '2026-06-17T10:00:00.000Z' },
        ],
        total: 4,
      });

      const result = await listReports({ limit: 2, offset: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.meta.offset).toBe(2);
    });

    it('clamps limit to max 100', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({ items: [], total: 0 });

      const result = await listReports({ limit: 500, offset: 0 });
      expect(result.meta.limit).toBe(100);
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledWith({ limit: 100, offset: 0 });
      expect(clampSpy).toHaveBeenCalledWith(500);
      expect(clampSpy).toHaveBeenCalledTimes(1);
    });

    it('handles undefined limit', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({ items: [], total: 0 });

      const result = await listReports({ limit: undefined as any, offset: 0 });
      expect(result.meta.limit).toBe(25);
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledWith({ limit: 25, offset: 0 });
      expect(clampSpy).toHaveBeenCalledWith(undefined);
    });

    it('returns meta.total from DB total, not from items.length', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({
        items: [
          { id: 'rpt-1', name: 'A', description: 'A (leads)', type: 'leads', createdAt: '2026-06-20T10:00:00.000Z' },
        ],
        total: 47,
      });

      const result = await listReports({ limit: 5, offset: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(47);
      expect(result.meta.total).not.toBe(result.items.length);
    });

    it('propagates filters (limit/offset) to repository without mutation', async () => {
      mockedRepo.findAvailableReports.mockResolvedValue({ items: [], total: 0 });

      await listReports({ limit: 7, offset: 3 });
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 7, offset: 3 }),
      );
      expect(mockedRepo.findAvailableReports).toHaveBeenCalledTimes(1);
      expect(clampSpy).toHaveBeenCalledWith(7);
    });
  });

  describe('getDashboardMetrics', () => {
    it('delegates to repository with actor info', async () => {
      const metrics = {
        totalLeads: 10,
        qualifiedLeads: 5,
        totalCampaigns: 2,
        activeOutreach: 3,
        pipelineConversion: 25,
        recentActivity: [],
      };
      mockedRepo.findDashboardMetrics.mockResolvedValue(metrics);

      const result = await getDashboardMetrics({ id: 'admin-1', role: 'admin' });
      expect(result).toEqual(metrics);
      expect(mockedRepo.findDashboardMetrics).toHaveBeenCalledWith('admin-1', 'admin');
    });

    it('works for sales role', async () => {
      const metrics = {
        totalLeads: 3,
        qualifiedLeads: 1,
        totalCampaigns: 0,
        activeOutreach: 2,
        pipelineConversion: 50,
        recentActivity: [{ date: '2026-06-21', leads: 1, outreach: 1 }],
      };
      mockedRepo.findDashboardMetrics.mockResolvedValue(metrics);

      const result = await getDashboardMetrics({ id: 'sales-1', role: 'sales' });
      expect(result.totalCampaigns).toBe(0);
      expect(mockedRepo.findDashboardMetrics).toHaveBeenCalledWith('sales-1', 'sales');
    });

    it('works for marketing role', async () => {
      mockedRepo.findDashboardMetrics.mockResolvedValue({
        totalLeads: 20,
        qualifiedLeads: 10,
        totalCampaigns: 5,
        activeOutreach: 8,
        pipelineConversion: 30,
        recentActivity: [],
      });

      const result = await getDashboardMetrics({ id: 'mkt-1', role: 'marketing' });
      expect(result.totalLeads).toBe(20);
      expect(mockedRepo.findDashboardMetrics).toHaveBeenCalledWith('mkt-1', 'marketing');
    });
  });

  describe('getLeadGenerationReport', () => {
    it('returns paginated rows', async () => {
      const rows = [
        { date: '2026-06-20', source: 'facebook', count: 5 },
        { date: '2026-06-21', source: 'google', count: 3 },
        { date: '2026-06-22', source: 'linkedin', count: 2 },
      ];
      mockedRepo.findLeadGenerationReport.mockResolvedValue(rows);

      const result = await getLeadGenerationReport(
        { limit: 2, offset: 0 },
        { id: 'admin-1', role: 'admin' },
      );
      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(3);
      expect(result.meta.limit).toBe(2);
      expect(mockedRepo.findLeadGenerationReport).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 2, offset: 0 }),
        'admin-1',
        'admin',
      );
    });

    it('applies date filters', async () => {
      mockedRepo.findLeadGenerationReport.mockResolvedValue([]);

      await getLeadGenerationReport(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        { id: 'mgr-1', role: 'manager' },
      );
      expect(mockedRepo.findLeadGenerationReport).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-06-01', endDate: '2026-06-30' }),
        'mgr-1',
        'manager',
      );
    });
  });

  describe('getOutreachReport', () => {
    it('returns paginated rows', async () => {
      const rows = [
        { date: '2026-06-20', channel: 'email', sent: 10, delivered: 8, opened: 4, replied: 2, failed: 0 },
        { date: '2026-06-21', channel: 'sms', sent: 5, delivered: 5, opened: 3, replied: 1, failed: 0 },
      ];
      mockedRepo.findOutreachReport.mockResolvedValue(rows);

      const result = await getOutreachReport(
        { limit: 25, offset: 0 },
        { id: 'admin-1', role: 'admin' },
      );
      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('getPipelineReport', () => {
    it('returns paginated rows', async () => {
      const rows = [
        { stageName: 'proposal', leadCount: 5, conversionRate: 20, avgDays: 3 },
        { stageName: 'closed', leadCount: 2, conversionRate: 100, avgDays: 1 },
      ];
      mockedRepo.findPipelineReport.mockResolvedValue(rows);

      const result = await getPipelineReport(
        { limit: 25, offset: 0 },
        { id: 'admin-1', role: 'admin' },
      );
      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('getSalesRepReport', () => {
    it('returns paginated rows', async () => {
      const rows = [
        { repId: 'u1', repName: 'Alice', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 0 },
      ];
      mockedRepo.findSalesRepReport.mockResolvedValue(rows);

      const result = await getSalesRepReport(
        { limit: 25, offset: 0 },
        { id: 'admin-1', role: 'admin' },
      );
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('enqueueExportJob', () => {
    it('enqueues csv export and writes audit log', async () => {
      mockedEnqueue.mockResolvedValue('job-123');
      mockedAudit.mockResolvedValue(undefined);

      const result = await enqueueExportJob(
        { reportType: 'leads', format: 'csv' },
        { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' },
      );

      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('queued');
      expect(mockedEnqueue).toHaveBeenCalledWith({
        reportType: 'leads',
        format: 'csv',
        actorId: 'admin-1',
        actorRole: 'admin',
      });
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'report.export_queued',
          entityType: 'report',
          entityId: 'job-123',
        }),
      );
    });

    it('enqueues xlsx export', async () => {
      mockedEnqueue.mockResolvedValue('job-456');
      mockedAudit.mockResolvedValue(undefined);

      const result = await enqueueExportJob(
        { reportType: 'dashboard', format: 'xlsx' },
        { id: 'sales-1', role: 'sales' },
      );

      expect(result.jobId).toBe('job-456');
      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'xlsx' }),
      );
    });

    it('enqueues pdf export', async () => {
      mockedEnqueue.mockResolvedValue('job-789');
      mockedAudit.mockResolvedValue(undefined);

      const result = await enqueueExportJob(
        { reportType: 'pipeline', format: 'pdf' },
        { id: 'mgr-1', role: 'manager' },
      );

      expect(result.jobId).toBe('job-789');
    });

    it('rejects invalid format', async () => {
      await expect(
        enqueueExportJob(
          { reportType: 'leads', format: 'txt' as any },
          { id: 'admin-1', role: 'admin' },
        ),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('passes filters when provided', async () => {
      mockedEnqueue.mockResolvedValue('job-filter');
      mockedAudit.mockResolvedValue(undefined);

      await enqueueExportJob(
        { reportType: 'leads', format: 'csv', filters: { startDate: '2026-06-01' } },
        { id: 'admin-1', role: 'admin' },
      );

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: { startDate: '2026-06-01' },
        }),
      );
    });

    it('passes undefined filters when not provided', async () => {
      mockedEnqueue.mockResolvedValue('job-nofilter');
      mockedAudit.mockResolvedValue(undefined);

      await enqueueExportJob(
        { reportType: 'leads', format: 'csv' },
        { id: 'admin-1', role: 'admin' },
      );

      expect(mockedEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: undefined,
        }),
      );
    });
  });
});
