import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import {
  getConfig,
  updateConfig,
  getEligibleUsers,
  assignManually,
  overrideAssignment,
  getUserAssignments,
} from './assignments.service';
import {
  manualAssignmentSchema,
  overrideAssignmentSchema,
  updateAssignmentConfigSchema,
} from './assignments.schema';

function actorFromReq(req: Request) {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, role: req.user.role, ipAddress: req.ip ?? null };
}

export async function getConfigHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = await getConfig();
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function updateConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateAssignmentConfigSchema.parse(req.body);
    const config = await updateConfig(parsed, actorFromReq(req));
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function listEligibleUsersHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = await getEligibleUsers();
    sendSuccess(res, users);
  } catch (err) {
    next(err);
  }
}

export async function manualAssignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = manualAssignmentSchema.parse(req.body);
    const assignment = await assignManually(parsed.lead_id, parsed.user_id, actorFromReq(req));
    sendSuccess(res, assignment, 201);
  } catch (err) {
    next(err);
  }
}

export async function overrideAssignHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = overrideAssignmentSchema.parse(req.body);
    const assignment = await overrideAssignment(
      parsed.lead_id,
      parsed.new_user_id,
      parsed.reason,
      actorFromReq(req),
    );
    sendSuccess(res, assignment);
  } catch (err) {
    next(err);
  }
}

export async function getUserAssignmentsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const assignments = await getUserAssignments(req.params.userId);
    sendSuccess(res, assignments);
  } catch (err) {
    next(err);
  }
}
