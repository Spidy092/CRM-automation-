import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import { createWorkflowSchema, workflowIdParamSchema } from './workflow.schema';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  pauseWorkflow,
  publishWorkflow,
  replayWorkflowEnrollment,
  resumeWorkflow,
  validateWorkflow,
} from './workflow.service';

function actorFromReq(req: Request): { id: string; ipAddress?: string | null } {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, ipAddress: req.ip ?? null };
}

function workflowIdFromReq(req: Request): string {
  return workflowIdParamSchema.parse(req.params).id;
}

export function validateWorkflowHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    sendSuccess(res, validateWorkflow(req.body));
  } catch (err) {
    next(err);
  }
}

export async function listWorkflowsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await listWorkflows());
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await getWorkflow(workflowIdFromReq(req)));
  } catch (err) {
    next(err);
  }
}

export async function createWorkflowHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createWorkflowSchema.parse(req.body);
    sendSuccess(res, await createWorkflow(input, actorFromReq(req)), 201);
  } catch (err) {
    next(err);
  }
}

export async function publishWorkflowHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await publishWorkflow(workflowIdFromReq(req), actorFromReq(req)));
  } catch (err) {
    next(err);
  }
}

export async function pauseWorkflowHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await pauseWorkflow(workflowIdFromReq(req), actorFromReq(req)));
  } catch (err) {
    next(err);
  }
}

export async function resumeWorkflowHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await resumeWorkflow(workflowIdFromReq(req), actorFromReq(req)));
  } catch (err) {
    next(err);
  }
}

export async function replayWorkflowEnrollmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    sendSuccess(res, await replayWorkflowEnrollment(workflowIdFromReq(req), actorFromReq(req)));
  } catch (err) {
    next(err);
  }
}
