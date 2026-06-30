import type { NextFunction, Request, Response } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<unknown>;

/**
 * Wraps a route handler so any thrown error or rejected promise is forwarded to
 * next() (the Express error handler) instead of becoming an unhandled rejection.
 *
 * Accepts both synchronous handlers (returning void) and async handlers
 * (returning a Promise) — `Promise.resolve` normalises the return value so the
 * `.catch` applies uniformly. This lets handlers stay synchronous when they have
 * no awaits without tripping the lint `require-await` rule.
 *
 * Mirrors the pattern used in modules/auth/auth.routes.ts.
 */
export function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
