import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  getIntegrationHandler,
  listIntegrationsHandler,
  testAllIntegrationsHandler,
  testIntegrationHandler,
  updateIntegrationHandler,
} from './integrations.controller';
import { oauthRoutes } from './oauth';

const router = Router();

// All routes require authentication.
router.use(authenticate);

// OAuth routes (admin-only, handled by oauthRoutes middleware)
router.use('/oauth', oauthRoutes);

// All authenticated roles may read the integration catalog (UI renders status).
router.get('/', wrap(listIntegrationsHandler));
router.get('/:id', wrap(getIntegrationHandler));

// Only admins may modify credentials or trigger single integration tests.
router.put('/:id', authorize('admin'), wrap(updateIntegrationHandler));
router.post('/:id/test', authorize('admin'), wrap(testIntegrationHandler));

// Admins, managers, and marketing may run a bulk health check across enabled integrations.
router.post(
  '/test-all',
  authorize('admin', 'manager', 'marketing'),
  wrap(testAllIntegrationsHandler),
);

export { router as integrationsRoutes };
