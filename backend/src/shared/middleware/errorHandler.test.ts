import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/node';
import { AppError, notFoundHandler, errorHandler } from './errorHandler';
import { sendError } from '../utils/response';

jest.mock('../utils/response', () => ({
  sendError: jest.fn(),
  sendSuccess: jest.fn(),
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

describe('AppError', () => {
  it('defaults statusCode to 400 and sets isAppError', () => {
    const err = new AppError('bad request');
    expect(err.statusCode).toBe(400);
    expect(err.isAppError).toBe(true);
    expect(err.message).toBe('bad request');
  });

  it('accepts a custom statusCode', () => {
    const err = new AppError('nope', 403);
    expect(err.statusCode).toBe(403);
  });
});

describe('notFoundHandler', () => {
  it('sends a 404 with the method and originalUrl', () => {
    const req = { method: 'GET', originalUrl: '/api/v1/missing' } as Request;
    const res = {} as Response;
    notFoundHandler(req, res);
    expect(sendError).toHaveBeenCalledWith(res, 'Route not found: GET /api/v1/missing', 404);
  });
});

describe('errorHandler', () => {
  function buildReq(originalUrl = '/api/v1/leads'): Request {
    return { originalUrl } as Request;
  }
  const res = {} as Response;
  const next = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles ZodError with a 422 and joined messages', () => {
    const zodErr = new ZodError([
      { code: 'custom', message: 'name is required', path: ['name'] },
      { code: 'custom', message: 'email invalid', path: ['email'] },
    ]);
    errorHandler(zodErr, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'name is required, email invalid', 422);
  });

  it('handles an AppError instance without reporting to Sentry below 500', () => {
    const err = new AppError('not found', 404);
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'not found', 404);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports AppError to Sentry when statusCode >= 500', () => {
    const err = new AppError('server exploded', 500);
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'server exploded', 500);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('handles a plain object carrying isAppError (surviving module reloads)', () => {
    const err = { message: 'reloaded error', statusCode: 409, isAppError: true };
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'reloaded error', 409);
  });

  it('handles a Postgres exclusion constraint violation (23P01)', () => {
    const err = { code: '23P01' };
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Conflict: Only one stage can be marked as Won/Lost per pipeline.',
      409,
    );
  });

  it('handles a Postgres unique constraint violation (23505)', () => {
    const err = { code: '23505' };
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(
      res,
      'Conflict: Resource already exists or violates a unique constraint.',
      409,
    );
  });

  it('falls back to a generic 500 for unknown Error instances and reports to Sentry', () => {
    const err = new Error('boom');
    errorHandler(err, buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Internal server error', 500);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  it('falls back to a generic 500 for non-Error thrown values', () => {
    errorHandler('a string error', buildReq(), res, next);
    expect(sendError).toHaveBeenCalledWith(res, 'Internal server error', 500);
    expect(Sentry.captureException).toHaveBeenCalledWith(new Error('a string error'));
  });
});
