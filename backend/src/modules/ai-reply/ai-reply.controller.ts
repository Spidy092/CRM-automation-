import type { Request, Response, NextFunction } from 'express';
import { classifyReplySchema, replyHistoryQuerySchema } from './ai-reply.schema';
import {
  classifyInboundReply,
  getReplyHistory,
  triggerClassification,
} from './ai-reply.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { wrap } from '../../shared/utils/asyncHandler';
import { z } from 'zod';

async function _classifyReplyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = classifyReplySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.message, 400);
    }

    const result = await classifyInboundReply({
      leadId: parsed.data.lead_id,
      channel: parsed.data.channel,
      messageText: parsed.data.message,
      externalMessageId: parsed.data.metadata?.external_message_id as string | undefined,
    });

    res.status(200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

async function _getReplyHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = replyHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.message, 400);
    }

    const { items, total } = await getReplyHistory({
      leadId: parsed.data.lead_id,
      campaignId: parsed.data.campaign_id,
      classification: parsed.data.classification,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    res.status(200).json(
      successResponse(items, {
        total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      }),
    );
  } catch (err) {
    next(err);
  }
}

async function _triggerReplyClassificationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leadId = req.params.leadId;
    const parsedLeadId = z.string().uuid().safeParse(leadId);
    if (!parsedLeadId.success) {
      throw new AppError('leadId must be a valid UUID', 400);
    }

    const body = classifyReplySchema.partial().safeParse(req.body);
    if (!body.success) {
      throw new AppError(body.error.message, 400);
    }

    await triggerClassification({
      leadId: parsedLeadId.data,
      channel: body.data.channel ?? 'email',
      messageText: body.data.message ?? '',
      externalMessageId: body.data.metadata?.external_message_id as string | undefined,
    });

    res.status(202).json(successResponse({ accepted: true }));
  } catch (err) {
    next(err);
  }
}

export const classifyReplyHandler = wrap(_classifyReplyHandler);
export const getReplyHistoryHandler = wrap(_getReplyHistoryHandler);
export const triggerReplyClassificationHandler = wrap(_triggerReplyClassificationHandler);
