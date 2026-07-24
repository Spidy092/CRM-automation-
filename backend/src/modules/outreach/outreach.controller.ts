import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  createSequenceSchema,
  updateSequenceSchema,
  leadIdParamSchema,
  listLogsQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  taskIdParamSchema,
  listTasksQuerySchema,
  manualSendSchema,
  quickSendSchema,
} from './outreach.schema';
import * as outreachService from './outreach.service';
import { OutreachActor } from './outreach.types';

function actorFromReq(req: Request): OutreachActor {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

// ── Sequences ───────────────────────────────────────────────────────────────

export async function listSequencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const result = await outreachService.listSequences(limit, offset);
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getSequenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const item = await outreachService.getSequence(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function createSequenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createSequenceSchema.parse(req.body);
    const created = await outreachService.createSequence(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateSequenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const input = updateSequenceSchema.parse(req.body);
    const updated = await outreachService.updateSequence(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteSequenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    await outreachService.removeSequence(id, actorFromReq(req));
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function getSequenceStatsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const stats = await outreachService.getSequenceStats(id);
    sendSuccess(res, stats);
  } catch (err) {
    next(err);
  }
}

// ── Outreach Logs / Timeline ────────────────────────────────────────────────

export async function getLeadTimelineHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { leadId } = leadIdParamSchema.parse(req.params);
    const parsed = listLogsQuerySchema.parse(req.query);
    const items = await outreachService.getLeadTimeline(leadId, parsed.limit ?? 50);
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getLeadLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { leadId } = leadIdParamSchema.parse(req.params);
    const parsed = listLogsQuerySchema.parse(req.query);
    const items = await outreachService.getLeadLogs(leadId, parsed.limit ?? 50);
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export async function listTasksHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listTasksQuerySchema.parse(req.query);
    const items = await outreachService.listTasks(query, actorFromReq(req));
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function sendManualOutreachHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = manualSendSchema.parse(req.body);
    const result = await outreachService.sendManualOutreach(input, actorFromReq(req));
    sendSuccess(res, result, 202);
  } catch (err) {
    next(err);
  }
}

export async function quickSendHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { leadId } = leadIdParamSchema.parse(req.params);
    const input = quickSendSchema.parse(req.body);
    const log = await outreachService.sendQuickMessage(leadId, input, actorFromReq(req));
    sendSuccess(res, log, 201);
  } catch (err) {
    next(err);
  }
}

export async function createTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createTaskSchema.parse(req.body);
    const created = await outreachService.createTask(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function getTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = taskIdParamSchema.parse(req.params);
    const item = await outreachService.getTask(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function updateTaskHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = taskIdParamSchema.parse(req.params);
    const input = updateTaskSchema.parse(req.body);
    const updated = await outreachService.updateTask(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
