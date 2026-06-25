import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { getAiSettingsHandler, updateAiSettingsHandler } from './ai-settings.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

/**
 * GET /api/v1/ai-settings
 * Readable by all authenticated roles.
 */
router.get(
  '/',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getAiSettingsHandler),
);

/**
 * PATCH /api/v1/ai-settings
 * Admin-only: only admins may change AI provider settings.
 */
router.patch(
  '/',
  authorize('admin'),
  wrap(updateAiSettingsHandler),
);

export { router as aiSettingsRoutes };
