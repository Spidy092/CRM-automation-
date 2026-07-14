import { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { AuthenticatedUser } from '../../shared/types';
import { createActivitySchema, listActivitiesQuerySchema } from './activities.schema';
import { createManualActivity, listActivities } from './activities.service';

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
    const result = await listActivities(leadId, actorFromReq(req), {
      limit: parsed.limit,
      offset: parsed.offset,
      type: parsed.type,
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
