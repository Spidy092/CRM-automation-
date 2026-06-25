import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { clampLimit } from '../../shared/utils/pagination';
import { enqueueReportExport } from '../../workers/queue';
import {
  findDashboardMetrics,
  findLeadGenerationReport,
  findOutreachReport,
  findPipelineReport,
  findSalesRepReport,
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
  ExportJobInput,
  ExportJobResult,
  ReportStub,
} from './reports.types';

const STUB_REPORTS: ReportStub[] = [
  {
    id: 'report-1',
    name: 'Lead Generation Report',
    description: 'Overview of leads generated over time.',
    type: 'leads',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'report-2',
    name: 'Outreach Performance Report',
    description: 'Outreach metrics by channel.',
    type: 'outreach',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'report-3',
    name: 'Pipeline Conversion Report',
    description: 'Conversion rates across pipeline stages.',
    type: 'pipeline',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'report-4',
    name: 'Sales Rep Performance Report',
    description: 'Performance metrics per sales representative.',
    type: 'reps',
    createdAt: new Date().toISOString(),
  },
];

function applyRoleScope(filters: ReportListFilters, actor: ReportActor): ReportListFilters {
  if (actor.role === 'sales') {
    return filters;
  }
  return filters;
}

export function listReports(
  filters: ReportListFilters,
): Promise<PaginatedResult<ReportStub>> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset ?? 0;
  const items = STUB_REPORTS.slice(offset, offset + limit);
  return Promise.resolve({
    items,
    meta: { limit, offset, total: STUB_REPORTS.length },
  });
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
