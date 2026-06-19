import { NextFunction, Request, Response, Router } from 'express';
import { publicLimiter } from '../../shared/middleware/rateLimiter';
import { authenticate } from '../../shared/middleware/auth';
import { wrap } from '../../shared/utils/asyncHandler';
import {
  forgotPasswordHandler,
  getMeHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  resetPasswordHandler,
} from './auth.controller';

const router = Router();

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Wraps async route handlers so rejected promises are forwarded to next()
// instead of triggering @typescript-eslint/no-misused-promises.
function wrapLocal(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}

// All auth endpoints are public (pre-authentication) but rate-limited at the
// stricter "public" tier (10 req/min) per TRD §4.1.
router.post('/login', publicLimiter, wrapLocal(loginHandler));
router.post('/refresh', publicLimiter, wrapLocal(refreshHandler));
router.post('/logout', publicLimiter, wrapLocal(logoutHandler));
router.post('/forgot-password', publicLimiter, wrapLocal(forgotPasswordHandler));
router.post('/reset-password', publicLimiter, wrapLocal(resetPasswordHandler));

// GET /me — Returns the currently authenticated user (from JWT payload).
// Protected: requires a valid Bearer token.
router.get('/me', authenticate, wrap(getMeHandler));

export { router as authRoutes };
