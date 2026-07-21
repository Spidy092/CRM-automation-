import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { logger } from '../../shared/utils/logger';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
} from './auth.schema';
import * as authService from './auth.service';

export async function loginHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const result = await authService.refresh(refreshToken);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(refreshToken);
    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword(email);

    // TODO(integrations team): wire to SendGrid/SMTP module to actually email resetToken.
    if (result) {
      logger.info('Password reset token generated', { email });
    }

    // Always return a generic success message to prevent email enumeration.
    sendSuccess(res, {
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(token, newPassword);
    sendSuccess(res, { message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getMeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Unauthorized', 401);
    }
    await Promise.resolve();
    sendSuccess(res, req.user);
  } catch (err) {
    next(err);
  }
}

// -----------------------------------------------------------------------------
// API Keys
// -----------------------------------------------------------------------------
import { createApiKeySchema } from './auth.schema';

export async function createApiKeyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);
    const input = createApiKeySchema.parse(req.body);
    const result = await authService.generateApiKey(req.user.id, input.name, input.expiresInDays);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getApiKeysHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);
    const result = await authService.getApiKeysForUser(req.user.id);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function deleteApiKeyHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);
    const id = req.params.id;
    if (!id) throw new AppError('API key ID is required', 400);
    await authService.removeApiKey(req.user.id, id);
    sendSuccess(res, { message: 'API key revoked successfully' });
  } catch (err) {
    next(err);
  }
}
