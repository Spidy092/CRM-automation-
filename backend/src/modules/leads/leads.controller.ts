import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { AuthenticatedUser } from '../../shared/types';
import { clampLimit, decodeCursor } from '../../shared/utils/pagination';
import {
  createLeadSchema,
  listLeadsQuerySchema,
  pauseLeadSchema,
  updateLeadSchema,
  bulkClassifySchema,
  bulkUpdateSchema,
  bulkPauseSchema,
} from './leads.schema';
import * as leadsService from './leads.service';
import { importLeads, isSupportedFile } from './leads.import';
import { enrichLead } from './leads.enrichment';
import { LeadInput, LeadListFilters } from './leads.types';

function actorFromReq(req: Request): {
  id: string;
  role: AuthenticatedUser['role'];
  ipAddress?: string | null;
} {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listLeadsQuerySchema.parse(req.query);
    let cursorTs: string | undefined;
    let cursorId: string | undefined;
    if (parsed.cursor) {
      const decoded = decodeCursor(parsed.cursor);
      if (!decoded) throw new AppError('Invalid cursor', 400);
      cursorTs = decoded.ts;
      cursorId = decoded.id;
    }

    const tags = parsed.tags
      ? parsed.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    const excludeTags = parsed.exclude_tags
      ? parsed.exclude_tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;

    const filters: LeadListFilters = {
      limit: clampLimit(parsed.limit),
      cursorTs,
      cursorId,
      offset: parsed.offset,
      countTotal: parsed.count_total || undefined,
      sortBy: parsed.sort_by,
      sortDir: parsed.sort_dir,
      status: parsed.status,
      classification: parsed.classification,
      source_platform: parsed.source_platform,
      industry: parsed.industry,
      country: parsed.country,
      assigned_to: parsed.assigned_to,
      search: parsed.search,
      tags,
      exclude_tags: excludeTags,
      created_after: parsed.created_after,
      unclassified: parsed.unclassified || undefined,
      pipeline_id: parsed.pipeline_id,
    };

    const result = await leadsService.listLeads(filters, actorFromReq(req));
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lead = await leadsService.getLeadById(req.params.id, actorFromReq(req));
    sendSuccess(res, lead);
  } catch (err) {
    next(err);
  }
}

export async function createLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createLeadSchema.parse(req.body) as LeadInput;
    const lead = await leadsService.createLead(input, actorFromReq(req));
    sendSuccess(res, lead, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateLeadSchema.parse(req.body);
    const lead = await leadsService.updateLeadFields(req.params.id, input, actorFromReq(req));
    sendSuccess(res, lead);
  } catch (err) {
    next(err);
  }
}

export async function deleteLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await leadsService.softDeleteLeadById(req.params.id, actorFromReq(req));
    sendSuccess(res, { message: 'Lead soft-deleted successfully' });
  } catch (err) {
    next(err);
  }
}

export async function pauseLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { paused } = pauseLeadSchema.parse(req.body);
    const lead = await leadsService.setLeadPaused(req.params.id, paused ?? true, actorFromReq(req));
    sendSuccess(res, lead);
  } catch (err) {
    next(err);
  }
}

export async function getLeadActivityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const activity = await leadsService.getLeadActivity(req.params.id, actorFromReq(req), limit);
    sendSuccess(res, activity);
  } catch (err) {
    next(err);
  }
}

export async function importLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.file) throw new AppError('No file uploaded (field name must be "file")', 400);
    const ALLOWED_MIMES = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!ALLOWED_MIMES.includes(req.file.mimetype) || !isSupportedFile(req.file.originalname)) {
      throw new AppError('Unsupported file type. Allowed: .csv, .xlsx, .xls', 400);
    }

    const body = req.body as Record<string, unknown>;
    const sourceField = body['source_platform'];
    const defaultSource =
      typeof sourceField === 'string' && sourceField.trim() ? sourceField.trim() : 'manual_upload';

    const summary = await importLeads(
      req.file.buffer,
      req.file.originalname,
      defaultSource,
      actorFromReq(req),
    );
    sendSuccess(res, summary, 201);
  } catch (err) {
    next(err);
  }
}

export async function enrichLeadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const lead = await enrichLead(req.params.id, actorFromReq(req));
    sendSuccess(res, lead, 200);
  } catch (err) {
    next(err);
  }
}

export async function bulkClassifyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { ids, classification } = bulkClassifySchema.parse(req.body);
    const actor = actorFromReq(req);
    const updated = await leadsService.bulkClassifyLeads(ids, classification, actor);
    sendSuccess(res, { updated });
  } catch (err) {
    next(err);
  }
}

export async function bulkUpdateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { ids, patch } = bulkUpdateSchema.parse(req.body);
    const actor = actorFromReq(req);
    const updated = await leadsService.bulkUpdateLeads(ids, patch, actor);
    sendSuccess(res, { updated });
  } catch (err) {
    next(err);
  }
}

export async function bulkPauseHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { ids, paused } = bulkPauseSchema.parse(req.body);
    const actor = actorFromReq(req);
    const result = await leadsService.bulkPauseLeads(ids, paused, actor);
    sendSuccess(res, typeof result === 'number' ? { updated: result, cancelledJobs: 0 } : result);
  } catch (err) {
    next(err);
  }
}
