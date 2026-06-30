import { Response } from 'express';
import { ApiResponse } from '../types';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: ApiResponse<T>['meta'],
): void {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}

export function sendError(res: Response, message: string, statusCode = 500): void {
  const body: ApiResponse = { success: false, error: message };
  res.status(statusCode).json(body);
}

/**
 * Build a success envelope body without sending it. Useful when a controller
 * needs to compose the response object directly (e.g. via `res.json(body)`)
 * instead of using `sendSuccess`, or when the same envelope shape must be
 * produced for non-Express responses (e.g. worker return values).
 */
export function successResponse<T>(data: T, meta?: ApiResponse<T>['meta']): ApiResponse<T> {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  return body;
}
