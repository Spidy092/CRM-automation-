import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  getConfigHandler,
  updateConfigHandler,
  listEligibleUsersHandler,
  manualAssignHandler,
  overrideAssignHandler,
  getUserAssignmentsHandler,
} from './assignments.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get('/config', authorize('admin', 'manager'), wrap(getConfigHandler));
router.put('/config', authorize('admin', 'manager'), wrap(updateConfigHandler));
router.get('/eligible-users', authorize('admin', 'manager'), wrap(listEligibleUsersHandler));
router.post('/manual', authorize('admin', 'manager'), wrap(manualAssignHandler));
router.post('/override', authorize('admin', 'manager'), wrap(overrideAssignHandler));
router.get('/user/:userId', authorize('admin', 'manager'), wrap(getUserAssignmentsHandler));

export { router as assignmentsRoutes };
