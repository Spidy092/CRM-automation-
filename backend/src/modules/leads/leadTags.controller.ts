import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import { leadTagsQuerySchema } from './leadTags.schema';
import { getLeadTags } from './leadTags.service';

export async function leadTagsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    leadTagsQuerySchema.parse(req.query);
    if (!req.user) throw new AppError('Unauthorized', 401);
    sendSuccess(res, await getLeadTags(req.user));
  } catch (error) {
    next(error);
  }
}
