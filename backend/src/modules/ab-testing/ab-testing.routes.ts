import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listVariantsHandler,
  getVariantHandler,
  createVariantHandler,
  updateVariantHandler,
  deleteVariantHandler,
  getABTestReportHandler,
  getVariantResultsHandler,
  promoteWinnerHandler,
  recordSnapshotsHandler,
} from './ab-testing.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

// ── Variant CRUD ──────────────────────────────────────────────────────────

router.get('/campaigns/:campaignId/variants', wrap(listVariantsHandler));
router.get('/variants/:variantId', wrap(getVariantHandler));
router.post(
  '/campaigns/:campaignId/variants',
  authorize('admin', 'manager', 'marketing'),
  wrap(createVariantHandler),
);
router.put(
  '/variants/:variantId',
  authorize('admin', 'manager', 'marketing'),
  wrap(updateVariantHandler),
);
router.delete('/variants/:variantId', authorize('admin', 'manager'), wrap(deleteVariantHandler));

// ── Reports & Analytics ───────────────────────────────────────────────────

router.get('/campaigns/:campaignId/report', wrap(getABTestReportHandler));
router.get('/variants/:variantId/results', wrap(getVariantResultsHandler));
router.post(
  '/campaigns/:campaignId/promote-winner',
  authorize('admin', 'manager'),
  wrap(promoteWinnerHandler),
);
router.post(
  '/campaigns/:campaignId/snapshots',
  authorize('admin', 'manager'),
  wrap(recordSnapshotsHandler),
);

export { router as abTestRoutes };
