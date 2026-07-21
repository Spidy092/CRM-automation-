import { Router } from 'express';
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

// All auth endpoints are public (pre-authentication) but rate-limited at the
// stricter "public" tier (10 req/min) per TRD §4.1.
router.post('/login', publicLimiter, wrap(loginHandler));
router.post('/refresh', publicLimiter, wrap(refreshHandler));
router.post('/logout', publicLimiter, wrap(logoutHandler));
router.post('/forgot-password', publicLimiter, wrap(forgotPasswordHandler));
router.post('/reset-password', publicLimiter, wrap(resetPasswordHandler));

// GET /me — Returns the currently authenticated user (from JWT payload).
// Protected: requires a valid Bearer token.
router.get('/me', authenticate, wrap(getMeHandler));

import { createApiKeyHandler, getApiKeysHandler, deleteApiKeyHandler } from './auth.controller';

// API Keys (Protected)
router.post('/api-keys', authenticate, wrap(createApiKeyHandler));
router.get('/api-keys', authenticate, wrap(getApiKeysHandler));
router.delete('/api-keys/:id', authenticate, wrap(deleteApiKeyHandler));

export { router as authRoutes };
