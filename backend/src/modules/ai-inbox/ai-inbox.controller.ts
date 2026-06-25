import type { Request, Response, NextFunction } from 'express';
import { listInboxSchema, actionInboxSchema } from './ai-inbox.schema';
import { listItems, actionItem } from './ai-inbox.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';

export async function getInbox(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listInboxSchema.safeParse(req.query);
    if (!query.success) throw new AppError(query.error.message, 400);

    const userId = req.user!.id;
    const { items, total } = await listItems({
      assigned_to: userId,
      status: query.data.status,
      item_type: query.data.item_type,
      limit: query.data.limit,
      offset: query.data.offset,
    });

    res.json(successResponse(items, {
      total,
      limit: query.data.limit,
      offset: query.data.offset,
    }));
  } catch (err) {
    next(err);
  }
}

export async function actionInboxItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = actionInboxSchema.safeParse(req.body);
    if (!body.success) throw new AppError(body.error.message, 400);

    const { id } = req.params;
    const userId = req.user!.id;

    const item = await actionItem(id, userId, body.data.action, body.data.snoozed_until);
    res.json(successResponse(item));
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      next(new AppError(err.message, 404));
    } else {
      next(err);
    }
  }
}
