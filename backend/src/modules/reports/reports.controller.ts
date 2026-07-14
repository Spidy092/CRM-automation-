import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { sendSuccess } from '../../shared/utils/response';
import {
  listReportsQuerySchema,
  exportReportSchema,
  campaignAnalyticsQuerySchema,
  integrationHealthQuerySchema,
} from './reports.schema';
import {
  listReports,
  getDashboardMetrics,
  getLeadGenerationReport,
  getOutreachReport,
  getPipelineReport,
  getSalesRepReport,
  getCampaignAnalyticsReport,
  getIntegrationHealthReport,
  enqueueExportJob,
} from './reports.service';
import { ReportListFilters, ExportJobInput } from './reports.types';
import { AppError } from '../../shared/middleware/errorHandler';

function actorFromReq(req: Request): { id: string; role: string; ipAddress?: string | null } {
  return {
    id: req.user!.id,
    role: req.user!.role,
    ipAddress: req.ip ?? null,
  };
}

export async function listReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listReportsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await listReports(filters);
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getDashboardHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const metrics = await getDashboardMetrics(actorFromReq(req));
    sendSuccess(res, metrics);
  } catch (err) {
    next(err);
  }
}

export async function getLeadGenerationReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listReportsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await getLeadGenerationReport(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getOutreachReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listReportsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await getOutreachReport(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getPipelineReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listReportsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await getPipelineReport(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getSalesRepReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listReportsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await getSalesRepReport(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getCampaignAnalyticsReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = campaignAnalyticsQuerySchema.parse(req.query);
    const filters: ReportListFilters = {
      limit: parsed.limit,
      offset: parsed.offset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    const result = await getCampaignAnalyticsReport(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getIntegrationHealthReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    integrationHealthQuerySchema.parse(req.query);
    const rows = await getIntegrationHealthReport(actorFromReq(req));
    sendSuccess(res, rows);
  } catch (err) {
    next(err);
  }
}

export async function exportReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = exportReportSchema.parse(req.body);
    const input: ExportJobInput = {
      reportType: parsed.reportType,
      format: parsed.format,
      filters: parsed.filters,
    };
    const result = await enqueueExportJob(input, actorFromReq(req));
    sendSuccess(res, result, 202);
  } catch (err) {
    next(err);
  }
}

/**
 * Download a completed export file.
 *
 * Security: jobId is validated to contain only safe characters, and the
 * resolved file path is checked to be inside the exports/ directory to
 * prevent directory traversal attacks.
 */
export function downloadExportHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { jobId } = req.params;

    // Validate jobId — only alphanumeric, hyphens, underscores, colons (BullMQ IDs)
    if (!/^[a-zA-Z0-9_\-:]+$/.test(jobId)) {
      throw new AppError('Invalid job ID format', 400);
    }

    const exportsDir = path.resolve(process.cwd(), 'exports');

    if (!fs.existsSync(exportsDir)) {
      throw new AppError('No exports directory found', 404);
    }

    // Find the first file whose name contains the jobId
    const files = fs.readdirSync(exportsDir).filter((f) => f.includes(jobId));
    if (files.length === 0) {
      throw new AppError('Export file not found. The job may still be processing.', 404);
    }

    const filename = files[0];
    const filePath = path.join(exportsDir, filename);

    // Guard against directory traversal
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(exportsDir + path.sep)) {
      throw new AppError('Invalid file path', 400);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new AppError('Export file not found', 404);
    }

    res.download(resolvedPath, filename, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  } catch (err) {
    next(err);
  }
}
