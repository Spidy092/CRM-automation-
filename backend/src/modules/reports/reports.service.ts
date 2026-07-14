import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { clampLimit } from '../../shared/utils/pagination';
import { enqueueReportExport } from '../../workers/queue';
import { getOrComputeReport } from './reports.cache';
import {
  findAvailableReports,
  findDashboardMetrics,
  findLeadGenerationReport,
  findOutreachReport,
  findPipelineReport,
  findSalesRepReport,
  findCampaignAnalytics,
  findIntegrationHealth,
} from './reports.repository';
import {
  ReportActor,
  ReportListFilters,
  PaginatedResult,
  DashboardMetrics,
  LeadGenerationRow,
  OutreachPerformanceRow,
  PipelineConversionRow,
  SalesRepPerformanceRow,
  CampaignAnalyticsRow,
  IntegrationHealthRow,
  AnalyticsCacheKey,
  ExportJobInput,
  ExportJobResult,
  ReportStub,
} from './reports.types';

function applyRoleScope(filters: ReportListFilters, actor: ReportActor): ReportListFilters {
  if (actor.role === 'sales') {
    return filters;
  }
  return filters;
}

export async function listReports(
  filters: ReportListFilters,
): Promise<PaginatedResult<ReportStub>> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset ?? 0;
  const { items, total } = await findAvailableReports({ ...filters, limit, offset });
  return {
    items,
    meta: { limit, offset, total },
  };
}

export async function getDashboardMetrics(actor: ReportActor): Promise<DashboardMetrics> {
  return findDashboardMetrics(actor.id, actor.role);
}

export async function getLeadGenerationReport(
  filters: ReportListFilters,
  actor: ReportActor,
): Promise<PaginatedResult<LeadGenerationRow>> {
  const scoped = applyRoleScope(filters, actor);
  const limit = clampLimit(scoped.limit);
  const offset = scoped.offset ?? 0;
  const rows = await findLeadGenerationReport(scoped, actor.id, actor.role);
  const items = rows.slice(offset, offset + limit);
  return {
    items,
    meta: { limit, offset, total: rows.length },
  };
}

export async function getOutreachReport(
  filters: ReportListFilters,
  actor: ReportActor,
): Promise<PaginatedResult<OutreachPerformanceRow>> {
  const scoped = applyRoleScope(filters, actor);
  const limit = clampLimit(scoped.limit);
  const offset = scoped.offset ?? 0;
  const rows = await findOutreachReport(scoped, actor.id, actor.role);
  const items = rows.slice(offset, offset + limit);
  return {
    items,
    meta: { limit, offset, total: rows.length },
  };
}

export async function getPipelineReport(
  filters: ReportListFilters,
  actor: ReportActor,
): Promise<PaginatedResult<PipelineConversionRow>> {
  const scoped = applyRoleScope(filters, actor);
  const limit = clampLimit(scoped.limit);
  const offset = scoped.offset ?? 0;
  const rows = await findPipelineReport(scoped, actor.id, actor.role);
  const items = rows.slice(offset, offset + limit);
  return {
    items,
    meta: { limit, offset, total: rows.length },
  };
}

export async function getSalesRepReport(
  filters: ReportListFilters,
  actor: ReportActor,
): Promise<PaginatedResult<SalesRepPerformanceRow>> {
  const scoped = applyRoleScope(filters, actor);
  const limit = clampLimit(scoped.limit);
  const offset = scoped.offset ?? 0;
  const rows = await findSalesRepReport(scoped, actor.id, actor.role);
  const items = rows.slice(offset, offset + limit);
  return {
    items,
    meta: { limit, offset, total: rows.length },
  };
}

export async function getCampaignAnalyticsReport(
  filters: ReportListFilters,
  actor: ReportActor,
): Promise<PaginatedResult<CampaignAnalyticsRow>> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset ?? 0;
  const cacheKey: AnalyticsCacheKey = `campaigns:${actor.role}:${filters.startDate ?? 'all'}:${filters.endDate ?? 'all'}`;
  const cached = await getOrComputeReport<CampaignAnalyticsRow[]>(cacheKey, () =>
    findCampaignAnalytics(filters, actor.id, actor.role),
  );
  const rows = cached.data;
  const items = rows.slice(offset, offset + limit);
  return {
    items,
    meta: { limit, offset, total: rows.length },
  };
}

export async function getIntegrationHealthReport(
  actor: ReportActor,
): Promise<IntegrationHealthRow[]> {
  const cacheKey: AnalyticsCacheKey = `integrations:${actor.role}`;
  const cached = await getOrComputeReport<IntegrationHealthRow[]>(cacheKey, () =>
    findIntegrationHealth(),
  );
  return cached.data;
}

export async function enqueueExportJob(
  input: ExportJobInput,
  actor: ReportActor,
): Promise<ExportJobResult> {
  const validFormats: ExportJobInput['format'][] = ['csv', 'xlsx', 'pdf'];
  if (!validFormats.includes(input.format)) {
    throw new AppError('Invalid export format', 400);
  }

  const jobId = await enqueueReportExport({
    reportType: input.reportType,
    format: input.format,
    filters: input.filters ?? undefined,
    actorId: actor.id,
    actorRole: actor.role,
  });

  const result: ExportJobResult = { jobId, status: 'queued' };

  await writeAuditLog({
    userId: actor.id,
    action: 'report.export_queued',
    entityType: 'report',
    entityId: jobId,
    newValue: { reportType: input.reportType, format: input.format },
    ipAddress: actor.ipAddress ?? null,
  });

  return result;
}
