import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { toAgentActor } from '../agent/agent.types';
import { getPlanForPreview } from './planner.service';
import { executePlan, cancelPlan, continuePlanIfReady } from './runner.service';

const planIdParamSchema = z.object({
  id: z.string().uuid('Invalid plan ID format'),
});

function validatePlanId(req: Request): string {
  const parsed = planIdParamSchema.safeParse(req.params);
  if (!parsed.success) throw new AppError(parsed.error.message, 400);
  return parsed.data.id;
}

export async function getPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = validatePlanId(req);
    const preview = await getPlanForPreview(planId);
    if (!preview) throw new AppError(`Plan not found: ${planId}`, 404);
    res.json(successResponse(preview));
  } catch (err) {
    next(err);
  }
}

export async function approvePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = validatePlanId(req);
    const actor = toAgentActor(req.user!, req.ip);
    const result = await executePlan(planId, actor);
    res.status(result.status === 'paused_for_approval' ? 202 : 200).json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function cancelPlanHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const planId = validatePlanId(req);
    const result = await cancelPlan(planId);
    res.json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function continuePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const planId = validatePlanId(req);
    const result = await continuePlanIfReady(planId);
    if (!result) {
      res.json(successResponse({ planId, status: 'noop' }));
      return;
    }
    res.json(successResponse(result));
  } catch (err) {
    next(err);
  }
}
