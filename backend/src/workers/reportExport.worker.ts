import fs from 'fs';
import path from 'path';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import xlsx from 'xlsx';
import { getBullConnection } from './queue';
import { REPORTS_QUEUE, type ReportExportJob } from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { AppError } from '../shared/middleware/errorHandler';
import { pushToUser } from '../modules/notifications/notifications.emitter';
import {
  findDashboardMetrics,
  findLeadGenerationReport,
  findOutreachReport,
  findPipelineReport,
  findSalesRepReport,
} from '../modules/reports/reports.repository';
import { type DashboardMetrics, type ReportListFilters } from '../modules/reports/reports.types';

export function startReportExportWorker(): Worker {
  const worker = new Worker(
    REPORTS_QUEUE,
    async (job: Job<ReportExportJob>) => {
      const start = Date.now();
      const meta = {
        jobId: job.id,
        jobName: job.name,
        reportType: job.data.reportType,
        format: job.data.format,
        actorId: job.data.actorId,
      };
      logger.info('report export job started', meta);

      try {
        const result = await handleReportExport(job.data, job.id as string);
        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: REPORTS_QUEUE }, durationSec);
        incJobsProcessed({ name: job.name, queue: REPORTS_QUEUE, status: 'success' });
        logger.info('report export job completed', {
          ...meta,
          durationSec,
          filePath: result.filePath,
        });
        return result;
      } catch (err) {
        incJobsFailed({ name: job.name, queue: REPORTS_QUEUE });
        logger.error('report export job failed', {
          ...meta,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 2,
    },
  );

  worker.on('ready', () => logger.info('report export worker ready', { queue: REPORTS_QUEUE }));
  worker.on('failed', (job, err) => {
    logger.error('report export worker failed event', {
      id: job?.id ?? 'unknown',
      name: job?.name,
      error: err.message,
    });
    Sentry.captureException(err, { extra: { jobId: job?.id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(REPORTS_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });

  return worker;
}

export async function handleReportExport(
  data: ReportExportJob,
  jobId: string,
): Promise<{ filePath: string }> {
  const { reportType, format, filters, actorId, actorRole } = data;

  let rows: Array<Record<string, unknown>>;

  switch (reportType) {
    case 'dashboard': {
      const metrics = await findDashboardMetrics(actorId, actorRole);
      rows = flattenDashboardMetrics(metrics);
      break;
    }
    case 'leads':
      rows = (await findLeadGenerationReport(
        buildFilters(filters),
        actorId,
        actorRole,
      )) as unknown as Array<Record<string, unknown>>;
      break;
    case 'outreach':
      rows = (await findOutreachReport(
        buildFilters(filters),
        actorId,
        actorRole,
      )) as unknown as Array<Record<string, unknown>>;
      break;
    case 'pipeline':
      rows = (await findPipelineReport(
        buildFilters(filters),
        actorId,
        actorRole,
      )) as unknown as Array<Record<string, unknown>>;
      break;
    case 'reps':
      rows = (await findSalesRepReport(
        buildFilters(filters),
        actorId,
        actorRole,
      )) as unknown as Array<Record<string, unknown>>;
      break;
    default:
      throw new AppError(`Unknown report type: ${reportType}`, 400);
  }

  const timestamp = Date.now();
  const dir = path.resolve(process.cwd(), 'exports');
  const filename = `report-${jobId}-${timestamp}.${format}`;
  const filePath = path.join(dir, filename);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  switch (format) {
    case 'csv': {
      const csvContent = generateCsv(rows);
      fs.writeFileSync(filePath, csvContent, 'utf-8');
      break;
    }
    case 'xlsx': {
      const ws = xlsx.utils.json_to_sheet(rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Report');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const buffer: Buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      fs.writeFileSync(filePath, buffer);
      break;
    }
    case 'pdf':
      throw new AppError('PDF export not yet implemented', 400);
    default:
      throw new AppError(`Unsupported export format: ${String(format)}`, 400);
  }

  void pushToUser(actorId, {
    id: `export:${jobId}`,
    type: 'export_ready',
    title: 'Export ready',
    message: `Your ${reportType} report (${format.toUpperCase()}) is ready to download.`,
    data: { jobId, reportType, format },
    timestamp: new Date().toISOString(),
  });

  return { filePath };
}

function buildFilters(filters: Record<string, unknown> | undefined): ReportListFilters {
  return {
    limit: 1000,
    offset: 0,
    ...(filters ?? {}),
  } as ReportListFilters;
}

function flattenDashboardMetrics(metrics: DashboardMetrics): Array<Record<string, unknown>> {
  return [
    {
      totalLeads: metrics.totalLeads,
      qualifiedLeads: metrics.qualifiedLeads,
      totalCampaigns: metrics.totalCampaigns,
      activeOutreach: metrics.activeOutreach,
      pipelineConversion: metrics.pipelineConversion,
    },
    ...metrics.recentActivity.map((point) => ({
      date: point.date,
      leads: point.leads,
      outreach: point.outreach,
    })),
  ];
}

function generateCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
    }
  }
  const headers = Array.from(headerSet);
  const lines: string[] = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      const str = val == null ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n') + '\n';
}
