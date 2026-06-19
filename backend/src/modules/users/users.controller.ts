import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { updateProfileSchema } from './users.schema';
import * as usersService from './users.service';

export async function listUsersHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const users = await usersService.listUsers();
    sendSuccess(res, users);
  } catch (err) {
    next(err);
  }
}

export async function getUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }
    const { id } = req.params;
    const user = await usersService.getUser(id, req.user);
    sendSuccess(res, user);
  } catch (err) {
    next(err);
  }
}

export async function updateProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }
    const { id } = req.params;
    const input = updateProfileSchema.parse(req.body);
    const updated = await usersService.updateProfile(id, input, req.user);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
