import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listActivityAuthorsHandler,
  createActivityHandler,
  listActivitiesHandler,
  updateActivityPinHandler,
} from './activities.controller';

const router = Router({ mergeParams: true });

router.use(wrap(authenticate), authenticatedLimiter);

router.get(
  '/authors',
  authorize('admin', 'manager', 'sales', 'viewer'),
  wrap(listActivityAuthorsHandler),
);

router.get('/', authorize('admin', 'manager', 'sales', 'viewer'), wrap(listActivitiesHandler));
router.post('/', authorize('admin', 'manager', 'sales'), wrap(createActivityHandler));
// Pin/unpin a note — same write roles as creating notes (viewers are read-only).
router.patch(
  '/:activityId/pin',
  authorize('admin', 'manager', 'sales'),
  wrap(updateActivityPinHandler),
);

export { router as activitiesRoutes };
