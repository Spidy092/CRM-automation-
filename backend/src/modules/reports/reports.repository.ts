import { pool } from '../../shared/utils/db';
import {
  DashboardMetrics,
  DashboardActivityPoint,
  LeadGenerationRow,
  OutreachPerformanceRow,
  PipelineConversionRow,
  SalesRepPerformanceRow,
  ReportListFilters,
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
    SELECT DATE(l.created_at) as date, l.source_platform as source, COUNT(*) as count
    FROM leads l
    WHERE ${where}
    GROUP BY DATE(l.created_at), l.source_platform
    ORDER BY date DESC
  `;
  const result = await pool.query<LeadGenerationRow & { count: string }>(sql, params);
  return result.rows.map((row) => ({
    date: String(row.date),
    source: row.source,
    count: parseInt(row.count, 10),
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
    conditions.push(`ol.created_at >= $${leadParams.length + dateParams.length}`);
  }
  if (filters.endDate) {
    dateParams.push(`${filters.endDate}T23:59:59.999Z`);
    conditions.push(`ol.created_at <= $${leadParams.length + dateParams.length}`);
  }
  const dateClause = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
  const params = [...leadParams, ...dateParams];

  let joinClause = '';
  if (actorRole === 'sales') {
    joinClause = `JOIN leads l ON ol.lead_id = l.id AND ${leadWhere}`;
  }

  const sql = `
    SELECT
      DATE(ol.created_at) as date,
      ol.channel,
      COUNT(*) FILTER (WHERE ol.status = 'sent') as sent,
      COUNT(*) FILTER (WHERE ol.status = 'delivered') as delivered,
      COUNT(*) FILTER (WHERE ol.status = 'opened') as opened,
      COUNT(*) FILTER (WHERE ol.status = 'replied') as replied,
      COUNT(*) FILTER (WHERE ol.status = 'failed') as failed
    FROM outreach_logs ol
    ${joinClause}
    WHERE ol.status IN ('sent', 'delivered', 'opened', 'replied', 'failed')
      ${actorRole === 'sales' ? '' : `AND EXISTS (SELECT 1 FROM leads l2 WHERE l2.id = ol.lead_id AND ${leadWhere})`}
      ${dateClause}
    GROUP BY DATE(ol.created_at), ol.channel
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
  }>(sql, params);
  return result.rows.map((row) => ({
    date: String(row.date),
    channel: row.channel,
    sent: parseInt(row.sent ?? '0', 10),
    delivered: parseInt(row.delivered ?? '0', 10),
    opened: parseInt(row.opened ?? '0', 10),
    replied: parseInt(row.replied ?? '0', 10),
    failed: parseInt(row.failed ?? '0', 10),
  }));
}

export async function findPipelineReport(
  _filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<PipelineConversionRow[]> {
  const { clause: leadWhere, params } = getLeadWhere(actorRole, actorId);

  const sql = `
    SELECT
      ps.name as stageName,
      COUNT(l.id) as leadCount,
      COALESCE(100.0 * COUNT(l.id) FILTER (WHERE l.status = 'won')
        / NULLIF(COUNT(l.id) FILTER (WHERE l.status IN ('active', 'won', 'lost')), 0), 0) as conversionRate,
      COALESCE(AVG(
        EXTRACT(EPOCH FROM (l.updated_at - l.created_at)) / 86400
      ) FILTER (WHERE l.status = 'won'), 0)::numeric as avgDays
    FROM leads l
    JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
    WHERE ${leadWhere}
    GROUP BY ps.name, ps.position
    ORDER BY ps.position
  `;
  const result = await pool.query<
    PipelineConversionRow & { leadCount: string; conversionRate: string; avgDays: string }
  >(sql, params);
  return result.rows.map((row) => ({
    stageName: row.stageName,
    leadCount: parseInt(row.leadCount, 10),
    conversionRate: parseFloat(row.conversionRate),
    avgDays: parseFloat(row.avgDays),
  }));
}

export async function findSalesRepReport(
  _filters: ReportListFilters,
  actorId: string,
  actorRole: string,
): Promise<SalesRepPerformanceRow[]> {
  // Sales reps only see their own record; managers/admins see all reps
  let whereClause = "u.role = 'sales'";
  const params: unknown[] = [];
  if (actorRole === 'sales') {
    params.push(actorId);
    whereClause += ` AND u.id = $${params.length}`;
  }

  const sql = `
    SELECT
      u.id as repId,
      u.name as repName,
      COUNT(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL) as leadsAssigned,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'won') as leadsConverted,
      COALESCE(100.0 * COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'won')
        / NULLIF(COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('active', 'won', 'lost')), 0), 0) as conversionRate,
      0::numeric as avgResponseTime
    FROM users u
    LEFT JOIN leads l ON l.assigned_to = u.id
    WHERE ${whereClause}
    GROUP BY u.id, u.name
    ORDER BY leadsConverted DESC
  `;
  const result = await pool.query<
    SalesRepPerformanceRow & {
      leadsAssigned: string;
      leadsConverted: string;
      conversionRate: string;
      avgResponseTime: string;
    }
  >(sql, params);
  return result.rows.map((row) => ({
    repId: row.repId,
    repName: row.repName,
    leadsAssigned: parseInt(row.leadsAssigned, 10),
    leadsConverted: parseInt(row.leadsConverted, 10),
    conversionRate: parseFloat(row.conversionRate),
    avgResponseTime: parseFloat(row.avgResponseTime),
  }));
}

// insertExportJob removed — service layer uses enqueueReportExport() from the BullMQ queue directly.
