import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  saveNewsletterDraftSchema,
  draftRevisionSchema,
  draftIdParamSchema,
  listNewsletterDraftsSchema,
} from './newsletter.schema';
import * as drafts from './newsletter.drafts.service';

type Action = 'list' | 'create' | 'update' | 'delete' | 'send';
export function draftHandler(
  action: Action,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next): Promise<void> => {
    try {
      if (action === 'list') {
        const { limit, offset } = listNewsletterDraftsSchema.parse(req.query);
        const result = await drafts.list(limit, offset);
        if (!result.ok) throw result.error;
        sendSuccess(res, result.value);
        return;
      }
      const id = action === 'create' ? undefined : draftIdParamSchema.parse(req.params).id;
      const actorId = req.user!.id;
      if (action === 'create' || action === 'update') {
        const { content, revision } = saveNewsletterDraftSchema.parse(req.body);
        if (id && revision === undefined) throw new AppError('Draft revision is required', 400);
        const result = await drafts.save(content, actorId, id, revision);
        if (!result.ok) throw result.error;
        sendSuccess(res, result.value, action === 'create' ? 201 : 200);
      } else {
        const { revision } = draftRevisionSchema.parse(req.body);
        const result =
          action === 'delete'
            ? await drafts.remove(id!, revision)
            : await drafts.send(id!, revision, actorId);
        if (!result.ok) throw result.error;
        sendSuccess(res, result.value);
      }
    } catch (err) {
      next(err);
    }
  };
}
