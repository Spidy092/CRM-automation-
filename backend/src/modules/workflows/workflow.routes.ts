import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  createWorkflowHandler,
  getWorkflowHandler,
  listWorkflowsHandler,
  pauseWorkflowHandler,
  publishWorkflowHandler,
  replayWorkflowEnrollmentHandler,
  resumeWorkflowHandler,
  validateWorkflowHandler,
} from './workflow.controller';

const router = Router();

router.use(wrap(authenticate), authenticatedLimiter);

// Draft validation remains persistence-free; published workflows are immutable
// versions and can be paused/resumed without mutating their definition.
router.post('/validate', authorize('admin', 'manager', 'marketing'), wrap(validateWorkflowHandler));
router.get(
  '/',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(listWorkflowsHandler),
);
router.get(
  '/:id',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getWorkflowHandler),
);
router.post('/', authorize('admin', 'manager', 'marketing'), wrap(createWorkflowHandler));
router.post(
  '/:id/publish',
  authorize('admin', 'manager', 'marketing'),
  wrap(publishWorkflowHandler),
);
router.post('/:id/pause', authorize('admin', 'manager', 'marketing'), wrap(pauseWorkflowHandler));
router.post('/:id/resume', authorize('admin', 'manager', 'marketing'), wrap(resumeWorkflowHandler));
router.post(
  '/enrollments/:id/replay',
  authorize('admin', 'manager'),
  wrap(replayWorkflowEnrollmentHandler),
);

export { router as workflowsRoutes };
