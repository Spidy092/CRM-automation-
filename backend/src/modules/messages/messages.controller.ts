import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  messageSnippetIdParamSchema,
  createMessageSnippetSchema,
  updateMessageSnippetSchema,
  listMessageSnippetsQuerySchema,
} from './messages.schema';
import * as messagesService from './messages.service';
import { MessageSnippetActor } from './messages.types';

function actorFromReq(req: Request): MessageSnippetActor {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listMessageSnippetsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listMessageSnippetsQuerySchema.parse(req.query);
    const items = await messagesService.listMessageSnippets(parsed);
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getMessageSnippetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = messageSnippetIdParamSchema.parse(req.params);
    const item = await messagesService.getMessageSnippet(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function createMessageSnippetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createMessageSnippetSchema.parse(req.body);
    const created = await messagesService.createMessageSnippet(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateMessageSnippetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = messageSnippetIdParamSchema.parse(req.params);
    const input = updateMessageSnippetSchema.parse(req.body);
    const updated = await messagesService.updateMessageSnippet(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteMessageSnippetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = messageSnippetIdParamSchema.parse(req.params);
    await messagesService.removeMessageSnippet(id, actorFromReq(req));
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
