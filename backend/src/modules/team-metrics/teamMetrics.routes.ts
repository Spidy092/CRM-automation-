import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { getTeamMetricsHandler } from './teamMetrics.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get(
  '/metrics',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getTeamMetricsHandler),
);

export { router as teamMetricsRoutes };
