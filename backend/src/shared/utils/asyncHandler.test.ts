import type { NextFunction, Request, Response } from 'express';
import { wrap } from './asyncHandler';

function buildMocks() {
  const req = {} as Request;
  const res = {} as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('wrap', () => {
  it('calls the handler and does not call next on success', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const { req, res, next } = buildMocks();
    wrap(handler)(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards rejection to next', async () => {
    const err = new Error('boom');
    const handler = jest.fn().mockRejectedValue(err);
    const { req, res, next } = buildMocks();
    wrap(handler)(req, res, next);
    await Promise.resolve();
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(err);
  });
});
