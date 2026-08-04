import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { updateProfileSchema, createUserSchema, updatePermissionsSchema, changePasswordSchema } from './users.schema';
import * as usersService from './users.service';

export async function createUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createUserSchema.parse(req.body);
    const user = await usersService.createUser(input);
    sendSuccess(res, user, 201);
  } catch (err) {
    next(err);
  }
}

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

export async function updatePermissionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }
    const { id } = req.params;
    const input = updatePermissionsSchema.parse(req.body);
    const updated = await usersService.updatePermissions(id, input, req.user);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }
    const { id } = req.params;
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await usersService.changePassword(id, currentPassword, newPassword, req.user);
    sendSuccess(res, { message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}
