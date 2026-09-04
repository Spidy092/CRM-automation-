import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';
import { getPlan, approvePlan, cancelPlanHandler, continuePlan } from './plan.controller';

const router = Router();

router.get(
  '/:id',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(getPlan),
);
router.post(
  '/:id/approve',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(approvePlan),
);
router.post(
  '/:id/cancel',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(cancelPlanHandler),
);
router.post(
  '/:id/continue',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing'),
  asyncHandler(continuePlan),
);

export default router;
