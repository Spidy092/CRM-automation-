import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { successResponse } from '../../shared/utils/response';
import { toAgentActor } from './agent.types';
import { executeAgentAction, proposeAgentAction, rejectAgentAction } from './agent.service';
import { proposeAgentActionSchema } from './agent.schema';

export async function proposeAction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = proposeAgentActionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const actor = req.user ? toAgentActor(req.user, req.ip) : parsed.data.actor;
    const result = await proposeAgentAction({ ...parsed.data, actor });
    res
      .status(result.policy.outcome === 'require_approval' ? 202 : 200)
      .json(successResponse(result));
  } catch (err) {
    next(err);
  }
}

export async function executeAction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const actor = toAgentActor(req.user!, req.ip);
    const action = await executeAgentAction(req.params.id, {
      actor,
      approvedBy: actor.id,
      source: 'manual',
    });
    res.json(successResponse(action));
  } catch (err) {
    next(err);
  }
}

export async function rejectAction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = toAgentActor(req.user!, req.ip);
    const action = await rejectAgentAction(req.params.id, actor.id);
    res.json(successResponse(action));
  } catch (err) {
    next(err);
  }
}
