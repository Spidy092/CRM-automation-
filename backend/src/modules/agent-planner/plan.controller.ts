import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { toAgentActor } from '../agent/agent.types';
import { getPlanForPreview } from './planner.service';
import { executePlan, cancelPlan, continuePlanIfReady } from './runner.service';

export async function getPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const preview = await getPlanForPreview(req.params.id);
    if (!preview) throw new AppError(`Plan not found: ${req.params.id}`, 404);
    res.json(successResponse(preview));
  } catch (err) {
    next(err);
  }
}

export async function approvePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = toAgentActor(req.user!, req.ip);
    const result = await executePlan(req.params.id, actor);
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
    const result = await cancelPlan(req.params.id);
    res.json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function continuePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await continuePlanIfReady(req.params.id);
    if (!result) {
      res.json(successResponse({ planId: req.params.id, status: 'noop' }));
      return;
    }
    res.json(successResponse(result));
  } catch (err) {
    next(err);
  }
}
