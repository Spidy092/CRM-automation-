import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { getInbox, actionInboxItem } from './ai-inbox.controller';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';

const router = Router();

// All roles that interact with leads can see their inbox
router.get(
  '/',
  authenticatedLimiter,
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(getInbox),
);

// Action an inbox item (approve / reject / snooze)
router.patch(
  '/:id/action',
  authenticatedLimiter,
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(actionInboxItem),
);

export default router;
