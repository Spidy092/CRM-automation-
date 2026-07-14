import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger';
import { sendError } from '../utils/response';

export class AppError extends Error {
  statusCode: number;
  readonly isAppError = true;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    logger.warn('Validation error', { errors: err.errors, path: req.originalUrl });
    sendError(res, err.errors.map((e) => e.message).join(', '), 422);
    return;
  }

  // Also check isAppError to survive ts-node-dev module reloads
  if (err instanceof AppError || (err && typeof err === 'object' && 'isAppError' in err)) {
    const appErr = err as AppError;
    logger.error('AppError caught in errorHandler', {
      message: appErr.message,
      statusCode: appErr.statusCode,
      path: req.originalUrl,
    });
    if (appErr.statusCode >= 500) Sentry.captureException(appErr);
    sendError(res, appErr.message, appErr.statusCode);
    return;
  }

  // Handle PostgreSQL constraints
  const pgError = err as { code?: string; constraint?: string };
  if (pgError.code === '23P01') {
    logger.warn('Exclusion constraint violation', { error: err });
    sendError(res, 'Conflict: Only one stage can be marked as Won/Lost per pipeline.', 409);
    return;
  }
  if (pgError.code === '23505') {
    logger.warn('Unique constraint violation', { error: err });
    sendError(res, 'Conflict: Resource already exists or violates a unique constraint.', 409);
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  logger.error('Unhandled error', {
    error: message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  sendError(res, 'Internal server error', 500);
}
