import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  getIntegrationHandler,
  listIntegrationsHandler,
  testIntegrationHandler,
  updateIntegrationHandler,
} from './integrations.controller';

const router = Router();

// All routes require authentication.
router.use(authenticate);

// All authenticated roles may read the integration catalog (UI renders status).
router.get('/', wrap(listIntegrationsHandler));
router.get('/:id', wrap(getIntegrationHandler));

// Only admins may modify credentials or trigger tests.
router.put('/:id', authorize('admin'), wrap(updateIntegrationHandler));
router.post('/:id/test', authorize('admin'), wrap(testIntegrationHandler));

export { router as integrationsRoutes };
