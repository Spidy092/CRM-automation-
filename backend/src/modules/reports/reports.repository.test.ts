import { pool } from '../../shared/utils/db';
import {
  findAvailableReports,
  findCampaignAnalytics,
  findDashboardMetrics,
  findIntegrationHealth,
  findLeadGenerationReport,
  findOutreachReport,
  findPipelineReport,
  findSalesRepReport,
} from './reports.repository';

jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../shared/utils/db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

describe('reports.repository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('findDashboardMetrics', () => {
    const baseRows = {
      totalLeads: [{ total: '10' }],
      qualifiedLeads: [{ total: '5' }],
      campaigns: [{ total: '3' }],
      outreach: [{ total: '8' }],
      conversion: [{ rate: '25.5' }],
      revenue: [{ revenue: '15000.50', deals: '4' }],
      activity: [
        { date: '2026-06-20', leads: '2', outreach: '1' },
        { date: '2026-06-21', leads: '3', outreach: '2' },
      ],
      sources: [{ name: 'facebook', value: '5' }],
      pipeline: [{ name: 'active', value: '5' }],
    };

    function setupMocks() {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult(baseRows.totalLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.qualifiedLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.campaigns))
        .mockResolvedValueOnce(mockQueryResult(baseRows.outreach))
        .mockResolvedValueOnce(mockQueryResult(baseRows.conversion))
        .mockResolvedValueOnce(mockQueryResult(baseRows.revenue))
        .mockResolvedValueOnce(mockQueryResult(baseRows.activity))
        .mockResolvedValueOnce(mockQueryResult(baseRows.sources));
    }

    it('returns metrics for admin', async () => {
      setupMocks();
      const result = await findDashboardMetrics('admin-1', 'admin');
      expect(result.totalLeads).toBe(10);
      expect(result.qualifiedLeads).toBe(5);
      expect(result.totalCampaigns).toBe(3);
      expect(result.activeOutreach).toBe(8);
      expect(result.pipelineConversion).toBe(25.5);
      expect(result.wonRevenue).toBe(15000.5);
      expect(result.wonDeals).toBe(4);
      expect(result.recentActivity).toHaveLength(2);
      expect(mockPoolQuery).toHaveBeenCalledTimes(8);
    });

    it('returns metrics for manager', async () => {
      setupMocks();
      const result = await findDashboardMetrics('mgr-1', 'manager');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(8);
    });

    it('returns metrics for sales (no campaigns)', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult(baseRows.totalLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.qualifiedLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.outreach))
        .mockResolvedValueOnce(mockQueryResult(baseRows.conversion))
        .mockResolvedValueOnce(mockQueryResult(baseRows.revenue))
        .mockResolvedValueOnce(mockQueryResult(baseRows.activity))
        .mockResolvedValueOnce(mockQueryResult(baseRows.pipeline));

      const result = await findDashboardMetrics('sales-1', 'sales');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(0);
      expect(result.activeOutreach).toBe(8);
      expect(result.wonRevenue).toBe(15000.5);
      expect(mockPoolQuery).toHaveBeenCalledTimes(7);
    });

    it('returns metrics for marketing', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult(baseRows.totalLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.qualifiedLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.campaigns))
        .mockResolvedValueOnce(mockQueryResult(baseRows.outreach))
        .mockResolvedValueOnce(mockQueryResult(baseRows.conversion))
        .mockResolvedValueOnce(mockQueryResult(baseRows.revenue))
        .mockResolvedValueOnce(mockQueryResult(baseRows.activity));

      const result = await findDashboardMetrics('mkt-1', 'marketing');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(7);
    });

    it('returns metrics for viewer', async () => {
      setupMocks();
      const result = await findDashboardMetrics('view-1', 'viewer');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(8);
    });

    it('handles empty results gracefully', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ rate: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ revenue: '0', deals: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([]))
        .mockResolvedValueOnce(mockQueryResult([]));

      const result = await findDashboardMetrics('admin-1', 'admin');
      expect(result.totalLeads).toBe(0);
      expect(result.qualifiedLeads).toBe(0);
      expect(result.pipelineConversion).toBe(0);
      expect(result.wonRevenue).toBe(0);
      expect(result.wonDeals).toBe(0);
      expect(result.recentActivity).toEqual([]);
    });
  });

  describe('findLeadGenerationReport', () => {
    it('returns rows for admin without date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { date: '2026-06-20', source: 'facebook', count: '5', qualified_count: '3', conversion_rate: '40' },
          { date: '2026-06-21', source: 'google', count: '3', qualified_count: '1', conversion_rate: '0' },
        ]),
      );

      const result = await findLeadGenerationReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        date: '2026-06-20',
        source: 'facebook',
        count: 5,
        qualifiedCount: 3,
        conversionRate: 40,
      });
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[1]).not.toContain('2026-06-01');
      expect(queryCall[0]).toContain('qualified_count');
      expect(queryCall[0]).toContain('conversion_rate');
    });

    it('returns rows for sales with date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { date: '2026-06-20', source: null, count: '2', qualified_count: '1', conversion_rate: '50' },
        ]),
      );

      const result = await findLeadGenerationReport(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        'sales-1',
        'sales',
      );
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(2);
      expect(result[0].qualifiedCount).toBe(1);
      expect(result[0].conversionRate).toBe(50);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('assigned_to = $1');
      expect(queryCall[0]).toContain('l.created_at >= $2');
      expect(queryCall[0]).toContain('l.created_at <= $3');
    });

    it('returns rows for marketing', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { date: '2026-06-20', source: 'campaign', count: '10', qualified_count: '6', conversion_rate: '20' },
        ]),
      );

      const result = await findLeadGenerationReport({ limit: 25, offset: 0 }, 'mkt-1', 'marketing');
      expect(result[0].source).toBe('campaign');
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('source_platform IS NOT NULL');
    });
  });

  describe('findOutreachReport', () => {
    it('returns rows for admin without date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-20',
            channel: 'email',
            sent: '10',
            delivered: '8',
            opened: '4',
            replied: '2',
            failed: '1',
          },
        ]),
      );

      const result = await findOutreachReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        date: '2026-06-20',
        channel: 'email',
        sent: 10,
        delivered: 8,
        opened: 4,
        replied: 2,
        failed: 1,
        bounced: 0,
        responseRate: 0,
      });
    });

    it('returns rows for sales with date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-20',
            channel: 'sms',
            sent: '5',
            delivered: '5',
            opened: '3',
            replied: '1',
            failed: '0',
          },
        ]),
      );

      const result = await findOutreachReport(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        'sales-1',
        'sales',
      );
      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('JOIN leads l ON ol.lead_id = l.id');
      expect(queryCall[0]).toContain('ol.sent_at >= $2');
      expect(queryCall[0]).toContain('ol.sent_at <= $3');
    });

    it('handles empty results', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      const result = await findOutreachReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toEqual([]);
    });
  });

  describe('findPipelineReport', () => {
    it('returns pipeline rows for admin', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { stageName: 'proposal', leadCount: '5', conversionRate: '20', avgDays: '3.5', avgDaysInStage: '0', dropOffRate: '0' },
          { stageName: 'closed', leadCount: '2', conversionRate: '100', avgDays: '1', avgDaysInStage: '0', dropOffRate: '0' },
        ]),
      );

      const result = await findPipelineReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        stageName: 'proposal',
        leadCount: 5,
        conversionRate: 20,
        avgDays: 3.5,
        avgDaysInStage: 0,
        dropOffRate: 0,
      });
      expect(result[1]).toEqual({
        stageName: 'closed',
        leadCount: 2,
        conversionRate: 100,
        avgDays: 1,
        avgDaysInStage: 0,
        dropOffRate: 0,
      });
    });

    it('returns pipeline rows for sales rep scoped to own leads', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { stageName: 'proposal', leadCount: '3', conversionRate: '33.33', avgDays: '2' },
        ]),
      );

      const result = await findPipelineReport({ limit: 25, offset: 0 }, 'sales-1', 'sales');
      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('assigned_to = $1');
    });
  });

  describe('findSalesRepReport', () => {
    it('returns all reps for admin', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            repId: 'u1',
            repName: 'Alice',
            leadsAssigned: '10',
            leadsConverted: '3',
            conversionRate: '30',
            avgResponseTime: '0',
          },
          {
            repId: 'u2',
            repName: 'Bob',
            leadsAssigned: '8',
            leadsConverted: '2',
            conversionRate: '25',
            avgResponseTime: '0',
          },
        ]),
      );

      const result = await findSalesRepReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(2);
      expect(result[0].repName).toBe('Alice');
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain("u.role = 'sales'");
      expect(queryCall[0]).not.toContain('u.id = $1');
    });

    it('returns only own record for sales rep', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            repId: 'sales-1',
            repName: 'Alice',
            leadsAssigned: '5',
            leadsConverted: '1',
            conversionRate: '20',
            avgResponseTime: '0',
          },
        ]),
      );

      const result = await findSalesRepReport({ limit: 25, offset: 0 }, 'sales-1', 'sales');
      expect(result).toHaveLength(1);
      expect(result[0].repId).toBe('sales-1');
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('u.id = $1');
      expect(queryCall[1]).toEqual(['sales-1']);
    });

    it('unknown/legacy roles do not scope the query by user id', async () => {
      // 'sales_rep' was renamed to 'sales' in migration 007.
      // Any unknown role string falls through without adding a user-id filter.
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            repId: 'rep-1',
            repName: 'Charlie',
            leadsAssigned: '4',
            leadsConverted: '1',
            conversionRate: '25',
            avgResponseTime: '0',
          },
          {
            repId: 'rep-2',
            repName: 'Diana',
            leadsAssigned: '3',
            leadsConverted: '0',
            conversionRate: '0',
            avgResponseTime: '0',
          },
        ]),
      );

      const result = await findSalesRepReport(
        { limit: 25, offset: 0 },
        'rep-1',
        'unknown_legacy_role',
      );
      expect(result).toHaveLength(2);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).not.toContain('u.id = $1');
    });

    it('returns all reps without date filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            repId: 'u1',
            repName: 'Alice',
            leadsAssigned: '10',
            leadsConverted: '3',
            conversionRate: '30',
            avgResponseTime: '0',
          },
        ]),
      );

      const result = await findSalesRepReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).not.toContain('l.created_at >=');
      expect(queryCall[0]).not.toContain('l.created_at <=');
    });
  });

  describe('findCampaignAnalytics', () => {
    it('returns aggregated rows for admin with date filter', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-20',
            campaignId: 'camp-1',
            campaignName: 'Summer Promo',
            leadsTargeted: '10',
            leadsConverted: '2',
            conversionRate: '20',
            channel: 'email',
          },
        ]),
      );

      const result = await findCampaignAnalytics(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        'admin-1',
        'admin',
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        date: '2026-06-20',
        campaignId: 'camp-1',
        campaignName: 'Summer Promo',
        leadsTargeted: 10,
        leadsConverted: 2,
        conversionRate: 20,
        channel: 'email',
      });
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('FROM campaigns c');
      expect(queryCall[0]).toContain('c.created_at >= $1');
      expect(queryCall[0]).toContain('cl.added_at >= $2');
    });

    it('returns aggregated rows for admin without date filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-20',
            campaignId: 'camp-1',
            campaignName: 'Summer Promo',
            leadsTargeted: '10',
            leadsConverted: '2',
            conversionRate: '20',
            channel: 'email',
          },
        ]),
      );

      const result = await findCampaignAnalytics({ limit: 25, offset: 0 }, 'admin-1', 'admin');

      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('FROM campaigns c');
      expect(queryCall[0]).not.toContain('c.created_at >= $1');
      expect(queryCall[0]).not.toContain('cl.added_at >= $2');
    });

    it('returns rows scoped to campaigns created by marketing user', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-21',
            campaignId: 'camp-2',
            campaignName: 'Mkt Campaign',
            leadsTargeted: '5',
            leadsConverted: '1',
            conversionRate: '20',
            channel: 'sms',
          },
        ]),
      );

      const result = await findCampaignAnalytics({ limit: 25, offset: 0 }, 'mkt-1', 'marketing');

      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('c.created_by = $1');
      expect(queryCall[1]).toEqual(['mkt-1']);
    });

    it('returns rows scoped to campaigns containing leads assigned to sales user', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            date: '2026-06-22',
            campaignId: 'camp-3',
            campaignName: 'Sales Campaign',
            leadsTargeted: '3',
            leadsConverted: '0',
            conversionRate: '0',
            channel: 'unknown',
          },
        ]),
      );

      const result = await findCampaignAnalytics({ limit: 25, offset: 0 }, 'sales-1', 'sales');

      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('l2.assigned_to = $1');
      expect(queryCall[1]).toEqual(['sales-1']);
    });

    it('returns empty array for viewer', async () => {
      const result = await findCampaignAnalytics({ limit: 25, offset: 0 }, 'view-1', 'viewer');

      expect(result).toEqual([]);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('handles empty query results', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await findCampaignAnalytics({ limit: 25, offset: 0 }, 'admin-1', 'admin');

      expect(result).toEqual([]);
    });
  });

  describe('findIntegrationHealth', () => {
    it('returns integration rows with computed status and success rate', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            integrationId: 'int-1',
            name: 'sendgrid',
            displayName: 'SendGrid Email',
            isEnabled: true,
            lastTestedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            lastTestStatus: 'ok',
            successRate: '95',
          },
          {
            integrationId: 'int-2',
            name: 'twilio',
            displayName: 'Twilio SMS',
            isEnabled: true,
            lastTestedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
            lastTestStatus: 'ok',
            successRate: '80',
          },
          {
            integrationId: 'int-3',
            name: 'whatsapp',
            displayName: 'WhatsApp Cloud API',
            isEnabled: false,
            lastTestedAt: null,
            lastTestStatus: null,
            successRate: '0',
          },
          {
            integrationId: 'int-4',
            name: 'smtp',
            displayName: 'SMTP Server',
            isEnabled: true,
            lastTestedAt: new Date().toISOString(),
            lastTestStatus: 'failed',
            successRate: '50',
          },
        ]),
      );

      const result = await findIntegrationHealth();

      expect(result).toHaveLength(4);
      expect(result[0].status).toBe('healthy');
      expect(result[0].successRate).toBe(95);
      expect(result[1].status).toBe('degraded');
      expect(result[1].successRate).toBe(80);
      expect(result[2].status).toBe('disabled');
      expect(result[2].successRate).toBe(0);
      expect(result[3].status).toBe('failing');
      expect(result[3].successRate).toBe(50);
    });

    it('handles empty results', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await findIntegrationHealth();

      expect(result).toEqual([]);
    });
  });

  describe('findAvailableReports', () => {
    it('returns active report schedules mapped to ReportStub with total', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          {
            id: 'rpt-1',
            name: 'Weekly Lead Summary',
            report_type: 'lead_generation',
            target_roles: ['admin', 'manager'],
            created_at: '2026-06-20T10:00:00.000Z',
            total_count: '42',
          },
          {
            id: 'rpt-2',
            name: 'Monthly Outreach Report',
            report_type: 'outreach',
            target_roles: ['admin'],
            created_at: '2026-06-15T08:30:00.000Z',
            total_count: '42',
          },
        ]),
      );

      const result = await findAvailableReports({ limit: 10, offset: 0 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(42);
      expect(result.items[0]).toEqual({
        id: 'rpt-1',
        name: 'Weekly Lead Summary',
        description: 'Weekly Lead Summary (lead_generation)',
        type: 'lead_generation',
        createdAt: '2026-06-20T10:00:00.000Z',
      });
      expect(result.items[1]).toEqual({
        id: 'rpt-2',
        name: 'Monthly Outreach Report',
        description: 'Monthly Outreach Report (outreach)',
        type: 'outreach',
        createdAt: '2026-06-15T08:30:00.000Z',
      });

      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('FROM report_schedules');
      expect(queryCall[0]).toContain('is_active = TRUE');
      expect(queryCall[0]).toContain('COUNT(*) OVER() AS total_count');
      expect(queryCall[0]).toContain('LIMIT $1 OFFSET $2');
      expect(queryCall[1]).toEqual([10, 0]);
    });

    it('passes limit and offset from filters', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await findAvailableReports({ limit: 5, offset: 10 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[1]).toEqual([5, 10]);
    });

    it('handles empty results', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));

      const result = await findAvailableReports({ limit: 25, offset: 0 });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
