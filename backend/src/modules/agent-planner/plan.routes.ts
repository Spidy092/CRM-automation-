import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';
import { getPlan, approvePlan, cancelPlanHandler, continuePlan } from './plan.controller';

const router = Router();

router.get(
  '/:id',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(getPlan),
);
router.post(
  '/:id/approve',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(approvePlan),
);
router.post(
  '/:id/cancel',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(cancelPlanHandler),
);
router.post(
  '/:id/continue',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(continuePlan),
);

export default router;
