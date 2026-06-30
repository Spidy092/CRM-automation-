import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';
import { executeAction, proposeAction, rejectAction } from './agent.controller';

const router = Router();

router.post(
  '/actions',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(proposeAction),
);
router.post(
  '/actions/:id/execute',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(executeAction),
);
router.post(
  '/actions/:id/reject',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(rejectAction),
);

export default router;
