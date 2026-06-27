import type { Request, Response, NextFunction } from 'express';
import {
  leadIdParamSchema,
  leadDecisionsQuerySchema,
  decisionLogQuerySchema,
} from './ai-intelligence.schema';
import { getAiProfile, getLeadDecisions, getDecisions } from './ai-intelligence.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';

/** GET /ai-intelligence/leads/:leadId/profile */
export async function getLeadProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = leadIdParamSchema.safeParse(req.params);
    if (!params.success) throw new AppError(params.error.message, 400);

    const profile = await getAiProfile(params.data.leadId);
    if (!profile) throw new AppError(`AI profile not found for lead: ${params.data.leadId}`, 404);

    res.json(successResponse(profile));
  } catch (err) {
    next(err);
  }
}

/** GET /ai-intelligence/leads/:leadId/decisions */
export async function getLeadDecisionLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = leadIdParamSchema.safeParse(req.params);
    if (!params.success) throw new AppError(params.error.message, 400);

    const query = leadDecisionsQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(query.error.message, 400);

    const { items, total } = await getLeadDecisions(
      params.data.leadId,
      query.data.limit,
      query.data.offset,
    );

    res.json(successResponse(items, { total, limit: query.data.limit, offset: query.data.offset }));
  } catch (err) {
    next(err);
  }
}

/** GET /ai-intelligence/decisions — admin audit trail */
export async function getDecisionLog(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = decisionLogQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(query.error.message, 400);

    const { items, total } = await getDecisions({
      decisionType: query.data.decision_type,
      limit: query.data.limit,
      offset: query.data.offset,
    });

    res.json(successResponse(items, { total, limit: query.data.limit, offset: query.data.offset }));
  } catch (err) {
    next(err);
  }
}
