import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { toAgentActor } from '../agent/agent.types';
import { chatHistoryParamsSchema, sendChatMessageSchema } from './chat.schema';
import { getChatHistory, sendChatMessage } from './chat.service';

export async function sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = sendChatMessageSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const user = req.user!;
    const result = await sendChatMessage({
      conversationId: parsed.data.conversationId,
      message: parsed.data.message,
      actor: toAgentActor(user, req.ip),
      user,
      pageContext: parsed.data.pageContext,
    });
    res
      .status(result.action?.policy.outcome === 'require_approval' ? 202 : 200)
      .json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = chatHistoryParamsSchema.safeParse(req.params);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const items = await getChatHistory(parsed.data.conversationId);
    res.json(successResponse(items));
  } catch (err) {
    next(err);
  }
}
