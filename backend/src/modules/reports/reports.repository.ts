import { pool } from '../../shared/utils/db';
import {
  DashboardMetrics,
  DashboardActivityPoint,
  LeadGenerationRow,
  OutreachPerformanceRow,
  PipelineConversionRow,
  SalesRepPerformanceRow,
  CampaignAnalyticsRow,
  IntegrationHealthRow,
  ReportListFilters,
  ReportStub,
} from './reports.types';

type WhereClause = { clause: string; params: unknown[] };

function getLeadWhere(role: string, actorId: string): WhereClause {
  switch (role) {
    case 'sales':
      return { clause: 'deleted_at IS NULL AND assigned_to = $1', params: [actorId] };
    case 'marketing':
      return {
        clause:
          'deleted_at IS NULL AND (source_platform IS NOT NULL OR EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = leads.id))',
        params: [],
      };
    case 'admin':
    case 'manager':
    case 'viewer':
    default:
      return { clause: 'deleted_at IS NULL', params: [] };
  }
}

function getActiveOutreachQuery(role: string, actorId: string): { sql: string; params: unknown[] } {
  const baseWhere = "status = 'sent' AND created_at >= NOW() - INTERVAL '30 days'";
  if (role === 'sales') {
    return {
      sql: `SELECT COUNT(*) as total FROM outreach_logs ol
            JOIN leads l ON ol.lead_id = l.id
            WHERE ol.${baseWhere} AND l.assigned_to = $1`,
      params: [actorId],
    };
  }
  return {
    sql: `SELECT COUNT(*) as total FROM outreach_logs WHERE ${baseWhere}`,
    params: [],
  };
}

function getRecentActivityQuery(role: string, actorId: string): { sql: string; params: unknown[] } {
  const leadBase = "deleted_at IS NULL AND created_at >= CURRENT_DATE - INTERVAL '6 days'";
  const outreachBase = "status = 'sent' AND created_at >= CURRENT_DATE - INTERVAL '6 days'";

  let leadWhere: string;
  let outreachFrom: string;
  let params: unknown[];

  switch (role) {
    case 'sales': {
      leadWhere = `${leadBase} AND assigned_to = $1`;
      const outreachWhere = `ol.${outreachBase} AND l.assigned_to = $1`;
      outreachFrom = `FROM outreach_logs ol JOIN leads l ON ol.lead_id = l.id WHERE ${outreachWhere}`;
      params = [actorId];
      break;
    }
    case 'marketing': {
      leadWhere = `${leadBase} AND (source_platform IS NOT NULL OR EXISTS (SELECT 1 FROM campaign_leads cl WHERE cl.lead_id = leads.id))`;
      outreachFrom = `FROM outreach_logs ol WHERE ol.${outreachBase}`;
      params = [];
      break;
    }
    case 'admin':
    case 'manager':
    case 'viewer':
    default: {
      leadWhere = leadBase;
      outreachFrom = `FROM outreach_logs ol WHERE ol.${outreachBase}`;
      params = [];
      break;
    }
  }

  const sql = `
    WITH days AS (
      SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
    )
    SELECT
      to_char(d.day, 'YYYY-MM-DD') as date,
      COALESCE(lc.count, 0)::int as leads,
      COALESCE(oc.count, 0)::int as outreach
    FROM days d
    LEFT JOIN (
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM leads
      WHERE ${leadWhere}
      GROUP BY DATE(created_at)
    ) lc ON d.day = lc.day
    LEFT JOIN (
      SELECT DATE(ol.created_at) as day, COUNT(*) as count
      ${outreachFrom}
      GROUP BY DATE(ol.created_at)
    ) oc ON d.day = oc.day
    ORDER BY d.day
  `;

  return { sql, params };
}

export async function findDashboardMetrics(
  actorId: string,
  actorRole: string,
): Promise<DashboardMetrics> {
  const { clause: leadWhere, params: leadParams } = getLeadWhere(actorRole, actorId);
  const { sql: outreachSql, params: outreachParams } = getActiveOutreachQuery(actorRole, actorId);
  const { sql: activitySql, params: activityParams } = getRecentActivityQuery(actorRole, actorId);

  // totalLeads
  const totalLeadsResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) as total FROM leads WHERE ${leadWhere}`,
    leadParams,
  );

  // qualifiedLeads
  const qualifiedLeadsResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) as total FROM leads WHERE ${leadWhere} AND (classification IN ('hot', 'warm') OR status = 'active')`,
    leadParams,
  );

  // totalCampaigns
  let totalCampaigns = 0;
  if (actorRole !== 'sales') {
    const campaignsResult = await pool.query<{ total: string }>(
      'SELECT COUNT(*) as total FROM campaigns WHERE deleted_at IS NULL',
    );
    totalCampaigns = parseInt(campaignsResult.rows[0]?.total ?? '0', 10);
  }

  // activeOutreach
  const outreachResult = await pool.query<{ total: string }>(outreachSql, outreachParams);

  // pipelineConversion
  const conversionResult = await pool.query<{ rate: string }>(
    `SELECT COALESCE(100.0 * COUNT(*) FILTER(WHERE status = 'won') / NULLIF(COUNT(*), 0), 0) as rate FROM leads WHERE ${leadWhere}`,
    leadParams,
  );

  // wonRevenue / wonDeals
  const revenueResult = await pool.query<{ revenue: string; deals: string }>(
    `SELECT COALESCE(SUM(deal_value) FILTER (WHERE status = 'won'), 0) as revenue,
            COUNT(*) FILTER (WHERE status = 'won') as deals
     FROM leads WHERE ${leadWhere}`,
    leadParams,
  );

  // recentActivity
  const activityResult = await pool.query<{ date: string; leads: string; outreach: string }>(
    activitySql,
    activityParams,
  );

  const recentActivity: DashboardActivityPoint[] = activityResult.rows.map((row) => ({
    date: row.date,
    leads: parseInt(row.leads ?? '0', 10),
    outreach: parseInt(row.outreach ?? '0', 10),
  }));

  return {
    totalLeads: parseInt(totalLeadsResult.rows[0]?.total ?? '0', 10),
    qualifiedLeads: parseInt(qualifiedLeadsResult.rows[0]?.total ?? '0', 10),
    totalCampaigns,
    activeOutreach: parseInt(outreachResult.rows[0]?.total ?? '0', 10),
    pipelineConversion: parseFloat(conversionResult.rows[0]?.rate ?? '0'),
    wonRevenue: parseFloat(revenueResult.rows[0]?.revenue ?? '0'),
    wonDeals: parseInt(revenueResult.rows[0]?.deals ?? '0', 10),
    recentActivity,
  };
}

function getDateRangeClause(
  tableAlias: string,
  filters: ReportListFilters,
  paramOffset: number = 0,
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.startDate) {
    params.push(filters.startDate);
    conditions.push(`${tableAlias}.created_at >= $${paramOffset + params.length}`);
  }
  if (filters.endDate) {
    // Extend end date to end of day
    params.push(`${filters.endDate}T23:59:59.999Z`);
    conditions.push(`${tableAlias}.created_at <= $${paramOffset + params.length}`);
  }
  return { clause: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '', params };
}

function getSalesRepDateClause(
  filters: ReportListFilters,
  paramOffset: number = 0,
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.startDate) {
    params.push(filters.startDate);
    conditions.push(
      `l.created_at >= $${paramOffset + params.length} OR (l.status = 'won' AND l.updated_at >= $${paramOffset + params.length})`,
    );
  }
  if (filters.endDate) {
    params.push(`${filters.endDate}T23:59:59.999Z`);
    conditions.push(
      `l.created_at <= $${paramOffset + params.length} OR (l.status = 'won' AND l.updated_at <= $${paramOffset + params.length})`,
    );
  }
  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }
  return {
    clause: ` AND (l.id IS NULL OR (${conditions.join(' AND ')}))`,
    params,
  };
}

export async function findLeadGenerationReport(
  filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<LeadGenerationRow[]> {
  const { clause: leadWhere, params: leadParams } = getLeadWhere(actorRole, actorId);
  const { clause: dateClause, params: dateParams } = getDateRangeClause(
    'l',
    filters,
    leadParams.length,
  );
  const params = [...leadParams, ...dateParams];
  const where = `${leadWhere}${dateClause}`;

  const sql = `
    SELECT
      DATE(l.created_at) as date,
      l.source_platform as source,
      COUNT(*) as count,
      COUNT(*) FILTER (WHERE l.classification IN ('hot', 'warm') OR l.status = 'active') as qualified_count,
      COALESCE(100.0 * COUNT(*) FILTER (WHERE l.status = 'won') / NULLIF(COUNT(*), 0), 0) as conversion_rate
    FROM leads l
    WHERE ${where}
    GROUP BY DATE(l.created_at), l.source_platform
    ORDER BY date DESC
  `;
  const result = await pool.query<
    LeadGenerationRow & { count: string; qualified_count: string; conversion_rate: string }
  >(sql, params);
  return result.rows.map((row) => ({
    date: String(row.date),
    source: row.source,
    count: parseInt(row.count, 10),
    qualifiedCount: parseInt(row.qualified_count ?? '0', 10),
    conversionRate: parseFloat(row.conversion_rate ?? '0'),
  }));
}

export async function findOutreachReport(
  filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<OutreachPerformanceRow[]> {
  const { clause: leadWhere, params: leadParams } = getLeadWhere(actorRole, actorId);
  const dateParams: unknown[] = [];
  const conditions: string[] = [];
  if (filters.startDate) {
    dateParams.push(filters.startDate);
    conditions.push(`ol.sent_at >= $${leadParams.length + dateParams.length}`);
  }
  if (filters.endDate) {
    dateParams.push(`${filters.endDate}T23:59:59.999Z`);
    conditions.push(`ol.sent_at <= $${leadParams.length + dateParams.length}`);
  }
  const dateClause = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
  const params = [...leadParams, ...dateParams];

  let joinClause = '';
  if (actorRole === 'sales') {
    joinClause = `JOIN leads l ON ol.lead_id = l.id AND ${leadWhere}`;
  }

  const sql = `
    SELECT
      DATE(ol.sent_at) as date,
      ol.channel,
      COUNT(*) FILTER (WHERE ol.status = 'sent') as sent,
      COUNT(*) FILTER (WHERE ol.status = 'delivered') as delivered,
      COUNT(*) FILTER (WHERE ol.status = 'opened') as opened,
      COUNT(*) FILTER (WHERE ol.status = 'replied') as replied,
      COUNT(*) FILTER (WHERE ol.status = 'failed') as failed,
      COUNT(*) FILTER (WHERE ol.status = 'bounced') as bounced,
      COALESCE(100.0 * COUNT(*) FILTER (WHERE ol.status = 'replied')
        / NULLIF(COUNT(*) FILTER (WHERE ol.status = 'sent'), 0), 0) as response_rate
    FROM outreach_logs ol
    ${joinClause}
    WHERE ol.status IN ('sent', 'delivered', 'opened', 'replied', 'failed', 'bounced')
      ${actorRole === 'sales' ? `AND ${leadWhere}` : `AND EXISTS (SELECT 1 FROM leads l2 WHERE l2.id = ol.lead_id AND ${leadWhere})`}
      ${dateClause}
    GROUP BY DATE(ol.sent_at), ol.channel
    ORDER BY date DESC
  `;
  const result = await pool.query<{
    date: string;
    channel: string;
    sent: string;
    delivered: string;
    opened: string;
    replied: string;
    failed: string;
    bounced: string;
    response_rate: string;
  }>(sql, params);
  return result.rows.map((row) => ({
    date: String(row.date),
    channel: row.channel,
    sent: parseInt(row.sent ?? '0', 10),
    delivered: parseInt(row.delivered ?? '0', 10),
    opened: parseInt(row.opened ?? '0', 10),
    replied: parseInt(row.replied ?? '0', 10),
    failed: parseInt(row.failed ?? '0', 10),
    bounced: parseInt(row.bounced ?? '0', 10),
    responseRate: parseFloat(row.response_rate ?? '0'),
  }));
}

export async function findPipelineReport(
  filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<PipelineConversionRow[]> {
  const { clause: leadWhere, params: leadParams } = getLeadWhere(actorRole, actorId);
  const { clause: dateClause, params: dateParams } = getDateRangeClause(
    'l',
    filters,
    leadParams.length,
  );
  const params = [...leadParams, ...dateParams];
  const where = `${leadWhere}${dateClause}`;

  const sql = `
    SELECT
      ps.name as stageName,
      COUNT(l.id) as leadCount,
      COALESCE(100.0 * COUNT(l.id) FILTER (WHERE l.status = 'won')
        / NULLIF(COUNT(l.id) FILTER (WHERE l.status IN ('active', 'won', 'lost')), 0), 0) as conversionRate,
      COALESCE(AVG(
        EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400
      ) FILTER (WHERE l.status = 'won'), 0)::numeric as avgDays,
      COALESCE(AVG(
        EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400
      ) FILTER (WHERE l.status IN ('active', 'won', 'lost')), 0)::numeric as avgDaysInStage,
      COALESCE(100.0 * COUNT(l.id) FILTER (WHERE l.status = 'lost')
        / NULLIF(COUNT(l.id), 0), 0) as dropOffRate
    FROM leads l
    JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
    WHERE ${where}
    GROUP BY ps.name, ps.position
    ORDER BY ps.position
  `;
  const result = await pool.query<
    PipelineConversionRow & {
      leadCount: string;
      conversionRate: string;
      avgDays: string;
      avgDaysInStage: string;
      dropOffRate: string;
    }
  >(sql, params);
  return result.rows.map((row) => ({
    stageName: row.stageName,
    leadCount: parseInt(row.leadCount, 10),
    conversionRate: parseFloat(row.conversionRate),
    avgDays: parseFloat(row.avgDays ?? '0'),
    avgDaysInStage: parseFloat(row.avgDaysInStage ?? '0'),
    dropOffRate: parseFloat(row.dropOffRate ?? '0'),
  }));
}

export async function findSalesRepReport(
  filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<SalesRepPerformanceRow[]> {
  // Sales reps only see their own record; managers/admins see all reps
  let whereClause = "u.role = 'sales'";
  const whereParams: unknown[] = [];
  if (actorRole === 'sales') {
    whereParams.push(actorId);
    whereClause += ` AND u.id = $${whereParams.length}`;
  }

  const { clause: dateClause, params: dateParams } = getSalesRepDateClause(
    filters,
    whereParams.length,
  );
  const params = [...whereParams, ...dateParams];

  const sql = `
    SELECT
      u.id as repId,
      u.name as repName,
      COUNT(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL) as leadsAssigned,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'won') as leadsConverted,
      COALESCE(100.0 * COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'won')
        / NULLIF(COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('active', 'won', 'lost')), 0), 0) as conversionRate,
      COALESCE(AVG(EXTRACT(EPOCH FROM (l.first_contacted_at - l.created_at)) / 3600)
        FILTER (WHERE l.first_contacted_at IS NOT NULL AND l.deleted_at IS NULL), 0)::numeric as avgResponseTime,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'won') as dealsClosed,
      COALESCE(SUM(l.deal_value) FILTER (WHERE l.status = 'won'), 0)::numeric as revenueEstimate
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE ${whereClause}${dateClause}
    GROUP BY u.id, u.name
    ORDER BY leadsConverted DESC
  `;
  const result = await pool.query<
    SalesRepPerformanceRow & {
      leadsAssigned: string;
      leadsConverted: string;
      conversionRate: string;
      avgResponseTime: string;
      dealsClosed: string;
      revenueEstimate: string;
    }
  >(sql, params);
  return result.rows.map((row) => ({
    repId: row.repId,
    repName: row.repName,
    leadsAssigned: parseInt(row.leadsAssigned, 10),
    leadsConverted: parseInt(row.leadsConverted, 10),
    conversionRate: parseFloat(row.conversionRate),
    avgResponseTime: parseFloat(row.avgResponseTime),
    dealsClosed: parseInt(row.dealsClosed, 10),
    revenueEstimate: parseFloat(row.revenueEstimate),
  }));
}

function getCampaignDateClause(
  filters: ReportListFilters,
  paramOffset: number = 0,
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.startDate) {
    params.push(filters.startDate);
    conditions.push(`c.created_at >= $${paramOffset + params.length}`);
    params.push(filters.startDate);
    conditions.push(`cl.added_at >= $${paramOffset + params.length}`);
  }
  if (filters.endDate) {
    const end = `${filters.endDate}T23:59:59.999Z`;
    params.push(end);
    conditions.push(`c.created_at <= $${paramOffset + params.length}`);
    params.push(end);
    conditions.push(`cl.added_at <= $${paramOffset + params.length}`);
  }
  return { clause: conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '', params };
}

function getCampaignRoleClause(
  role: string,
  actorId: string,
): { clause: string; params: unknown[] } {
  switch (role) {
    case 'viewer':
      return { clause: ' AND FALSE', params: [] };
    case 'marketing':
      return { clause: ' AND c.created_by = $1', params: [actorId] };
    case 'sales':
      return {
        clause: ` AND EXISTS (
          SELECT 1 FROM campaign_leads cl2
          JOIN leads l2 ON cl2.lead_id = l2.id
          WHERE cl2.campaign_id = c.id AND l2.assigned_to = $1
        )`,
        params: [actorId],
      };
    case 'admin':
    case 'manager':
    default:
      return { clause: '', params: [] };
  }
}

export async function findCampaignAnalytics(
  filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<CampaignAnalyticsRow[]> {
  if (actorRole === 'viewer') {
    return [];
  }

  const { clause: roleClause, params: roleParams } = getCampaignRoleClause(actorRole, actorId);
  const { clause: dateClause, params: dateParams } = getCampaignDateClause(
    filters,
    roleParams.length,
  );
  const params = [...roleParams, ...dateParams];

  const sql = `
    WITH campaign_channels AS (
      SELECT
        ol.campaign_id,
        mode() WITHIN GROUP (ORDER BY ol.channel) AS channel
      FROM outreach_logs ol
      WHERE ol.campaign_id IS NOT NULL
      GROUP BY ol.campaign_id
    )
    SELECT
      DATE(cl.added_at) AS date,
      c.id AS "campaignId",
      c.name AS "campaignName",
      COUNT(*) AS "leadsTargeted",
      COUNT(*) FILTER (WHERE l.status = 'won') AS "leadsConverted",
      COALESCE(100.0 * COUNT(*) FILTER (WHERE l.status = 'won')
        / NULLIF(COUNT(*), 0), 0) AS "conversionRate",
      COALESCE(cc.channel, 'unknown') AS channel
    FROM campaigns c
    JOIN campaign_leads cl ON c.id = cl.campaign_id
    JOIN leads l ON cl.lead_id = l.id
    LEFT JOIN campaign_channels cc ON cc.campaign_id = c.id
    WHERE c.deleted_at IS NULL
      ${roleClause}
      ${dateClause}
    GROUP BY DATE(cl.added_at), c.id, c.name, cc.channel
    ORDER BY date DESC, c.name ASC
  `;

  const result = await pool.query<
    CampaignAnalyticsRow & {
      leadsTargeted: string;
      leadsConverted: string;
      conversionRate: string;
    }
  >(sql, params);

  return result.rows.map((row) => ({
    date: String(row.date),
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    leadsTargeted: parseInt(row.leadsTargeted, 10),
    leadsConverted: parseInt(row.leadsConverted, 10),
    conversionRate: parseFloat(row.conversionRate),
    channel: row.channel,
  }));
}

function deriveIntegrationStatus(row: {
  isEnabled: boolean;
  lastTestStatus: string | null;
  lastTestedAt: string | null;
}): IntegrationHealthRow['status'] {
  if (!row.isEnabled) return 'disabled';
  if (!row.lastTestStatus) return 'healthy';
  if (row.lastTestStatus !== 'ok') return 'failing';
  if (row.lastTestedAt) {
    const testedAt = new Date(row.lastTestedAt);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (testedAt < oneDayAgo) return 'degraded';
  }
  return 'healthy';
}

export async function findIntegrationHealth(): Promise<IntegrationHealthRow[]> {
  const sql = `
    SELECT
      i.id AS "integrationId",
      i.name,
      i.display_name AS "displayName",
      i.is_enabled AS "isEnabled",
      i.last_tested_at AS "lastTestedAt",
      i.last_test_status AS "lastTestStatus",
      COALESCE(100.0 * COUNT(ol.id) FILTER (WHERE ol.status IN ('delivered', 'opened', 'replied'))
        / NULLIF(COUNT(ol.id) FILTER (WHERE ol.status IN ('sent', 'delivered', 'opened', 'replied', 'failed')), 0), 0) AS "successRate"
    FROM integrations i
    LEFT JOIN outreach_logs ol ON (
        (ol.channel::text = LOWER(i.name))
        OR (i.name = 'twilio' AND ol.channel = 'sms')
        OR (i.name IN ('sendgrid', 'smtp', 'outlook') AND ol.channel = 'email')
      )
      AND ol.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY i.id, i.name, i.display_name, i.is_enabled, i.last_tested_at, i.last_test_status
    ORDER BY i.display_name ASC
  `;

  const result = await pool.query<
    IntegrationHealthRow & {
      isEnabled: boolean;
      lastTestedAt: string | null;
      lastTestStatus: string | null;
      successRate: string;
    }
  >(sql);

  return result.rows.map((row) => ({
    integrationId: row.integrationId,
    name: row.name,
    displayName: row.displayName,
    channel: row.name,
    status: deriveIntegrationStatus(row),
    enabled: row.isEnabled,
    lastTestedAt: row.lastTestedAt ?? '',
    successRate: parseFloat(row.successRate),
  }));
}

// insertExportJob removed — service layer uses enqueueReportExport() from the BullMQ queue directly.

export async function findAvailableReports(
  filters: ReportListFilters,
): Promise<{ items: ReportStub[]; total: number }> {
  const sql = `
    SELECT id, name, report_type, target_roles, created_at, COUNT(*) OVER() AS total_count
    FROM report_schedules
    WHERE is_active = TRUE
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;
  const result = await pool.query<{
    id: string;
    name: string;
    report_type: string;
    target_roles: string[];
    created_at: string;
    total_count: string;
  }>(sql, [filters.limit, filters.offset]);

  const items = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: `${row.name} (${row.report_type})`,
    type: row.report_type,
    createdAt: row.created_at,
  }));
  const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
  return { items, total };
}
