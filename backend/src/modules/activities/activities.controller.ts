import { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { decodeCursor } from '../../shared/utils/pagination';
import { AppError } from '../../shared/middleware/errorHandler';
import { AuthenticatedUser } from '../../shared/types';
import {
  activityAuthorsParamsSchema,
  createActivitySchema,
  listActivitiesQuerySchema,
  updateActivityPinSchema,
} from './activities.schema';
import {
  createManualActivity,
  listActivities,
  listActivityAuthors,
  setNotePinned,
} from './activities.service';

function actorFromReq(req: Request): {
  id: string;
  role: AuthenticatedUser['role'];
  ipAddress?: string | null;
} {
  const user = req.user;
  if (!user) throw new AppError('Unauthenticated', 401);
  return {
    id: user.id,
    role: user.role,
    ipAddress: req.ip ?? null,
  };
}

export async function listActivitiesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leadId = req.params.leadId ?? req.params.id;
    if (!leadId) throw new AppError('Lead ID is required', 400);

    const parsed = listActivitiesQuerySchema.parse(req.query);
    let cursorTs: string | undefined;
    let cursorId: string | undefined;
    if (parsed.cursor) {
      const decoded = decodeCursor(parsed.cursor);
      if (!decoded) throw new AppError('Invalid cursor', 400);
      cursorTs = decoded.ts;
      cursorId = decoded.id;
    }
    const result = await listActivities(leadId, actorFromReq(req), {
      limit: parsed.limit,
      offset: parsed.offset,
      type: parsed.type,
      cursorTs,
      cursorId,
      search: parsed.search,
      authorId: parsed.author,
      dateFrom: parsed.date_from,
      dateTo: parsed.date_to,
      pinnedOnly: parsed.pinned_only || undefined,
    });
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function createActivityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leadId = req.params.leadId ?? req.params.id;
    if (!leadId) throw new AppError('Lead ID is required', 400);

    const parsed = createActivitySchema.parse(req.body);
    const activity = await createManualActivity(leadId, req.user!.id, parsed.type, parsed.metadata);
    sendSuccess(res, activity, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateActivityPinHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leadId = req.params.leadId ?? req.params.id;
    if (!leadId) throw new AppError('Lead ID is required', 400);
    const activityId = req.params.activityId;
    if (!activityId) throw new AppError('Activity ID is required', 400);

    const parsed = updateActivityPinSchema.parse(req.body);
    const activity = await setNotePinned(leadId, activityId, parsed.pinned, actorFromReq(req));
    sendSuccess(res, activity);
  } catch (err) {
    next(err);
  }
}

export async function listActivityAuthorsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { leadId } = activityAuthorsParamsSchema.parse({
      leadId: req.params.leadId ?? req.params.id,
    });
    sendSuccess(res, await listActivityAuthors(leadId, actorFromReq(req)));
  } catch (err) {
    next(err);
  }
}
