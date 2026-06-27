import { pool } from '../../shared/utils/db';
import {
  findAvailableReports,
  findDashboardMetrics,
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
  return Promise.resolve({ rows, command: 'SELECT', oid: 0, fields: [], rowCount: rows.length } as any);
}

describe('reports.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findDashboardMetrics', () => {
    const baseRows = {
      totalLeads: [{ total: '10' }],
      qualifiedLeads: [{ total: '5' }],
      campaigns: [{ total: '3' }],
      outreach: [{ total: '8' }],
      conversion: [{ rate: '25.5' }],
      activity: [
        { date: '2026-06-20', leads: '2', outreach: '1' },
        { date: '2026-06-21', leads: '3', outreach: '2' },
      ],
    };

    function setupMocks() {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult(baseRows.totalLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.qualifiedLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.campaigns))
        .mockResolvedValueOnce(mockQueryResult(baseRows.outreach))
        .mockResolvedValueOnce(mockQueryResult(baseRows.conversion))
        .mockResolvedValueOnce(mockQueryResult(baseRows.activity));
    }

    it('returns metrics for admin', async () => {
      setupMocks();
      const result = await findDashboardMetrics('admin-1', 'admin');
      expect(result.totalLeads).toBe(10);
      expect(result.qualifiedLeads).toBe(5);
      expect(result.totalCampaigns).toBe(3);
      expect(result.activeOutreach).toBe(8);
      expect(result.pipelineConversion).toBe(25.5);
      expect(result.recentActivity).toHaveLength(2);
      expect(mockPoolQuery).toHaveBeenCalledTimes(6);
    });

    it('returns metrics for manager', async () => {
      setupMocks();
      const result = await findDashboardMetrics('mgr-1', 'manager');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(6);
    });

    it('returns metrics for sales (no campaigns)', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult(baseRows.totalLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.qualifiedLeads))
        .mockResolvedValueOnce(mockQueryResult(baseRows.outreach))
        .mockResolvedValueOnce(mockQueryResult(baseRows.conversion))
        .mockResolvedValueOnce(mockQueryResult(baseRows.activity));

      const result = await findDashboardMetrics('sales-1', 'sales');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(0);
      expect(result.activeOutreach).toBe(8);
      expect(mockPoolQuery).toHaveBeenCalledTimes(5);
    });

    it('returns metrics for marketing', async () => {
      setupMocks();
      const result = await findDashboardMetrics('mkt-1', 'marketing');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(6);
    });

    it('returns metrics for viewer', async () => {
      setupMocks();
      const result = await findDashboardMetrics('view-1', 'viewer');
      expect(result.totalLeads).toBe(10);
      expect(result.totalCampaigns).toBe(3);
      expect(mockPoolQuery).toHaveBeenCalledTimes(6);
    });

    it('handles empty results gracefully', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([{ rate: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([]));

      const result = await findDashboardMetrics('admin-1', 'admin');
      expect(result.totalLeads).toBe(0);
      expect(result.qualifiedLeads).toBe(0);
      expect(result.pipelineConversion).toBe(0);
      expect(result.recentActivity).toEqual([]);
    });
  });

  describe('findLeadGenerationReport', () => {
    it('returns rows for admin without date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([
          { date: '2026-06-20', source: 'facebook', count: '5' },
          { date: '2026-06-21', source: 'google', count: '3' },
        ]),
      );

      const result = await findLeadGenerationReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ date: '2026-06-20', source: 'facebook', count: 5 });
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[1]).not.toContain('2026-06-01');
    });

    it('returns rows for sales with date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([{ date: '2026-06-20', source: null, count: '2' }]),
      );

      const result = await findLeadGenerationReport(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        'sales-1',
        'sales',
      );
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(2);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('assigned_to = $1');
      expect(queryCall[0]).toContain('l.created_at >= $2');
      expect(queryCall[0]).toContain('l.created_at <= $3');
    });

    it('returns rows for marketing', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([{ date: '2026-06-20', source: 'campaign', count: '10' }]),
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
      });
    });

    it('returns rows for sales with date range', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([{ date: '2026-06-20', channel: 'sms', sent: '5', delivered: '5', opened: '3', replied: '1', failed: '0' }]),
      );

      const result = await findOutreachReport(
        { limit: 25, offset: 0, startDate: '2026-06-01', endDate: '2026-06-30' },
        'sales-1',
        'sales',
      );
      expect(result).toHaveLength(1);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).toContain('JOIN leads l ON ol.lead_id = l.id');
      expect(queryCall[0]).toContain('ol.created_at >= $2');
      expect(queryCall[0]).toContain('ol.created_at <= $3');
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
          { stageName: 'proposal', leadCount: '5', conversionRate: '20', avgDays: '3.5' },
          { stageName: 'closed', leadCount: '2', conversionRate: '100', avgDays: '1' },
        ]),
      );

      const result = await findPipelineReport({ limit: 25, offset: 0 }, 'admin-1', 'admin');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ stageName: 'proposal', leadCount: 5, conversionRate: 20, avgDays: 3.5 });
      expect(result[1]).toEqual({ stageName: 'closed', leadCount: 2, conversionRate: 100, avgDays: 1 });
    });

    it('returns pipeline rows for sales rep scoped to own leads', async () => {
      mockPoolQuery.mockResolvedValueOnce(
        mockQueryResult([{ stageName: 'proposal', leadCount: '3', conversionRate: '33.33', avgDays: '2' }]),
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
          { repId: 'u1', repName: 'Alice', leadsAssigned: '10', leadsConverted: '3', conversionRate: '30', avgResponseTime: '0' },
          { repId: 'u2', repName: 'Bob', leadsAssigned: '8', leadsConverted: '2', conversionRate: '25', avgResponseTime: '0' },
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
          { repId: 'sales-1', repName: 'Alice', leadsAssigned: '5', leadsConverted: '1', conversionRate: '20', avgResponseTime: '0' },
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
          { repId: 'rep-1', repName: 'Charlie', leadsAssigned: '4', leadsConverted: '1', conversionRate: '25', avgResponseTime: '0' },
          { repId: 'rep-2', repName: 'Diana', leadsAssigned: '3', leadsConverted: '0', conversionRate: '0', avgResponseTime: '0' },
        ]),
      );

      const result = await findSalesRepReport({ limit: 25, offset: 0 }, 'rep-1', 'unknown_legacy_role');
      expect(result).toHaveLength(2);
      const queryCall = mockPoolQuery.mock.calls[0];
      expect(queryCall[0]).not.toContain('u.id = $1');
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
