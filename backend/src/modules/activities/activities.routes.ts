import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { createActivityHandler, listActivitiesHandler } from './activities.controller';

const router = Router({ mergeParams: true });

router.use(authenticate, authenticatedLimiter);

router.get('/', authorize('admin', 'manager', 'sales', 'viewer'), wrap(listActivitiesHandler));
router.post('/', authorize('admin', 'manager', 'sales'), wrap(createActivityHandler));

export { router as activitiesRoutes };
