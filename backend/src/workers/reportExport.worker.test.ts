/**
 * Report export worker tests.
 *
 * Tests:
 *   - startReportExportWorker starts without error
 *   - handleReportExport for each report type + format
 *   - CSV generation (with commas, quotes, newlines)
 *   - XLSX generation
 *   - PDF throws AppError
 *   - Unknown report type throws AppError
 *   - exports directory is created when missing
 */

import {
  startReportExportWorker,
  handleReportExport,
} from './reportExport.worker';

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  REPORTS_QUEUE: 'reports',
  REPORT_EXPORT: 'report:export',
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../modules/reports/reports.repository', () => ({
  findDashboardMetrics: jest.fn(),
  findLeadGenerationReport: jest.fn(),
  findOutreachReport: jest.fn(),
  findPipelineReport: jest.fn(),
  findSalesRepReport: jest.fn(),
  findCampaignAnalytics: jest.fn(),
  findIntegrationHealth: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('xlsx', () => ({
  utils: {
    json_to_sheet: jest.fn(() => ({} as any)),
    book_new: jest.fn(() => ({} as any)),
    book_append_sheet: jest.fn(),
  },
  write: jest.fn(() => Buffer.from('mock-xlsx')),
}));

import { findDashboardMetrics, findLeadGenerationReport, findCampaignAnalytics, findIntegrationHealth } from '../modules/reports/reports.repository';
import fs from 'fs';
import xlsx from 'xlsx';

describe('startReportExportWorker', () => {
  it('starts without error when redis is available', () => {
    expect(() => startReportExportWorker()).not.toThrow();
  });
});

describe('handleReportExport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
  });

  const baseDashboardMetrics = {
    totalLeads: 10,
    qualifiedLeads: 5,
    totalCampaigns: 2,
    activeOutreach: 3,
    pipelineConversion: 25.5,
    recentActivity: [
      { date: '2026-06-20', leads: 2, outreach: 1 },
      { date: '2026-06-21', leads: 3, outreach: 2 },
    ],
  };

  it('exports dashboard metrics to csv', async () => {
    (findDashboardMetrics as jest.Mock).mockResolvedValue(baseDashboardMetrics);

    const result = await handleReportExport(
      {
        reportType: 'dashboard',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-1',
    );

    expect(findDashboardMetrics).toHaveBeenCalledWith('user1', 'admin');
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(result.filePath).toMatch(/report-job-1-\d+\.csv$/);
    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('totalLeads,qualifiedLeads');
    expect(written).toContain('10,5');
    expect(written).toContain('date,leads,outreach');
    expect(written).toContain(',,,,,2026-06-20,2,1');
  });

  it('exports leads report to csv', async () => {
    const leadRows = [
      { date: '2026-06-20', source: 'facebook', count: 5 },
      { date: '2026-06-21', source: 'google', count: 3 },
    ];
    (findLeadGenerationReport as jest.Mock).mockResolvedValue(leadRows);

    await handleReportExport(
      {
        reportType: 'leads',
        format: 'csv',
        filters: { startDate: '2026-06-01' },
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-2',
    );

    expect(findLeadGenerationReport).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-06-01', limit: 1000, offset: 0 }),
      'user1',
      'admin',
    );
    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('date,source,count');
    expect(written).toContain('facebook,5');
  });

  it('exports outreach report to xlsx', async () => {
    const { findOutreachReport } = await import('../modules/reports/reports.repository');
    const outreachRows = [
      { date: '2026-06-20', channel: 'email', sent: 10, delivered: 8, opened: 4, replied: 2, failed: 0 },
    ];
    (findOutreachReport as jest.Mock).mockResolvedValue(outreachRows);

    const result = await handleReportExport(
      {
        reportType: 'outreach',
        format: 'xlsx',
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-3',
    );

    expect(findOutreachReport).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000, offset: 0 }),
      'user1',
      'admin',
    );
    expect(xlsx.utils.json_to_sheet).toHaveBeenCalled();
    expect(xlsx.write).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(result.filePath).toMatch(/report-job-3-\d+\.xlsx$/);
  });

  it('exports pipeline report to csv', async () => {
    const { findPipelineReport } = await import('../modules/reports/reports.repository');
    const pipelineRows = [
      { stageName: 'proposal', leadCount: 5, conversionRate: 20, avgDays: 3 },
    ];
    (findPipelineReport as jest.Mock).mockResolvedValue(pipelineRows);

    await handleReportExport(
      {
        reportType: 'pipeline',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-4',
    );

    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('stageName,leadCount,conversionRate,avgDays');
    expect(written).toContain('proposal,5,20,3');
  });

  it('exports reps report to csv', async () => {
    const { findSalesRepReport } = await import('../modules/reports/reports.repository');
    const repRows = [
      { repId: 'u1', repName: 'Alice', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 0 },
    ];
    (findSalesRepReport as jest.Mock).mockResolvedValue(repRows);

    await handleReportExport(
      {
        reportType: 'reps',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'manager',
      },
      'job-5',
    );

    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('repId,repName,leadsAssigned,leadsConverted,conversionRate,avgResponseTime');
    expect(written).toContain('u1,Alice,10,3,30,0');
  });

  describe('campaigns', () => {
    it('exports campaign analytics to csv', async () => {
      const campaignRows = [
        { date: '2026-06-20', campaignId: 'c1', campaignName: 'Summer Sale', channel: 'email', leadsTargeted: 100, leadsConverted: 10, conversionRate: 10 },
        { date: '2026-06-21', campaignId: 'c2', campaignName: 'Winter Sale', channel: 'sms', leadsTargeted: 200, leadsConverted: 25, conversionRate: 12.5 },
      ];
      (findCampaignAnalytics as jest.Mock).mockResolvedValue(campaignRows);

      const result = await handleReportExport(
        {
          reportType: 'campaigns',
          format: 'csv',
          actorId: 'user1',
          actorRole: 'admin',
        },
        'job-c1',
      );

      expect(findCampaignAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1000, offset: 0 }),
        'user1',
        'admin',
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.filePath).toMatch(/report-job-c1-\d+\.csv$/);
      const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('date,campaignId,campaignName,channel,leadsTargeted,leadsConverted,conversionRate');
      expect(written).toContain('2026-06-20,c1,Summer Sale,email,100,10,10.00');
      expect(written).toContain('2026-06-21,c2,Winter Sale,sms,200,25,12.50');
    });

    it('produces empty csv when campaign rows are empty', async () => {
      (findCampaignAnalytics as jest.Mock).mockResolvedValue([]);

      const result = await handleReportExport(
        {
          reportType: 'campaigns',
          format: 'csv',
          actorId: 'user1',
          actorRole: 'admin',
        },
        'job-c2',
      );

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.filePath).toMatch(/report-job-c2-\d+\.csv$/);
      const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toBe('');
    });
  });

  describe('integrations', () => {
    it('exports integration health to csv', async () => {
      const integrationRows = [
        { integrationId: 'i1', name: 'salesforce', displayName: 'Salesforce', channel: 'crm', status: 'healthy', enabled: true, lastTestedAt: '2026-06-20T10:00:00Z', successRate: 99.9 },
        { integrationId: 'i2', name: 'hubspot', displayName: 'HubSpot', channel: 'crm', status: 'failing', enabled: false, lastTestedAt: '2026-06-21T11:00:00Z', successRate: 45 },
      ];
      (findIntegrationHealth as jest.Mock).mockResolvedValue(integrationRows);

      const result = await handleReportExport(
        {
          reportType: 'integrations',
          format: 'csv',
          actorId: 'user1',
          actorRole: 'admin',
        },
        'job-i1',
      );

      expect(findIntegrationHealth).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.filePath).toMatch(/report-job-i1-\d+\.csv$/);
      const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toContain('integrationId,name,displayName,status,enabled,lastTestedAt,successRate');
      expect(written).toContain('i1,salesforce,Salesforce,healthy,true,2026-06-20T10:00:00Z,99.90');
      expect(written).toContain('i2,hubspot,HubSpot,failing,false,2026-06-21T11:00:00Z,45.00');
    });

    it('produces empty csv when integration rows are empty', async () => {
      (findIntegrationHealth as jest.Mock).mockResolvedValue([]);

      const result = await handleReportExport(
        {
          reportType: 'integrations',
          format: 'csv',
          actorId: 'user1',
          actorRole: 'admin',
        },
        'job-i2',
      );

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result.filePath).toMatch(/report-job-i2-\d+\.csv$/);
      const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(written).toBe('');
    });
  });

  it('throws AppError for pdf format', async () => {
    (findDashboardMetrics as jest.Mock).mockResolvedValue(baseDashboardMetrics);

    await expect(
      handleReportExport(
        {
          reportType: 'dashboard',
          format: 'pdf',
          actorId: 'user1',
          actorRole: 'admin',
        },
        'job-6',
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'PDF export not yet implemented' });
  });

  it('throws AppError for unknown report type', async () => {
    await expect(
      handleReportExport(
        {
          reportType: 'unknown',
          format: 'csv',
          actorId: 'user1',
          actorRole: 'admin',
        } as any,
        'job-7',
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Unknown report type: unknown' });
  });

  it('creates exports directory when missing', async () => {
    (findDashboardMetrics as jest.Mock).mockResolvedValue(baseDashboardMetrics);
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await handleReportExport(
      {
        reportType: 'dashboard',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-8',
    );

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('escapes commas and quotes in csv values', async () => {
    const { findSalesRepReport } = await import('../modules/reports/reports.repository');
    const repRows = [
      { repId: 'u1', repName: 'Alice, "The Closer"', leadsAssigned: 10, leadsConverted: 3, conversionRate: 30, avgResponseTime: 0 },
    ];
    (findSalesRepReport as jest.Mock).mockResolvedValue(repRows);

    await handleReportExport(
      {
        reportType: 'reps',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'manager',
      },
      'job-9',
    );

    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('"Alice, ""The Closer"""');
  });

  it('produces empty csv when rows are empty', async () => {
    (findDashboardMetrics as jest.Mock).mockResolvedValue({
      ...baseDashboardMetrics,
      recentActivity: [],
    });

    await handleReportExport(
      {
        reportType: 'dashboard',
        format: 'csv',
        actorId: 'user1',
        actorRole: 'admin',
      },
      'job-10',
    );

    const written = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
    expect(written).toContain('totalLeads,qualifiedLeads');
    expect(written).toContain('10,5');
  });
});
