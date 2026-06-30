/**
 * Error-classification helpers.
 *
 * Use these when a caller needs to discriminate between error categories
 * (e.g. swallow a "not found" but re-throw a 5xx, or return a default value
 * on conflict). For everything else, let the central `errorHandler`
 * translate the error into an HTTP response.
 *
 * The duck-typed check on `isAppError` mirrors the survival logic in
 * `src/shared/middleware/errorHandler.ts`: under ts-node-dev reloads the
 * prototype chain check (`err instanceof AppError`) can fail because there
 * are two copies of the AppError class in memory. The `isAppError = true`
 * flag is the safe discriminator across reloads.
 */

import { AppError } from '../middleware/errorHandler';

export function isAppError(err: unknown): err is AppError {
  if (err instanceof AppError) return true;
  if (err && typeof err === 'object' && 'isAppError' in err) {
    const candidate = err as { isAppError?: unknown; statusCode?: unknown };
    return candidate.isAppError === true && typeof candidate.statusCode === 'number';
  }
  return false;
}

export function isNotFound(err: unknown): boolean {
  return isAppError(err) && err.statusCode === 404;
}

export function isConflict(err: unknown): boolean {
  return isAppError(err) && err.statusCode === 409;
}

export function isValidationError(err: unknown): boolean {
  return isAppError(err) && err.statusCode === 400;
}

export function isUnauthorized(err: unknown): boolean {
  return isAppError(err) && err.statusCode === 401;
}

export function isForbidden(err: unknown): boolean {
  return isAppError(err) && err.statusCode === 403;
}
