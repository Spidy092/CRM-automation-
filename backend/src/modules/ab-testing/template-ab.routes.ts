import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listTemplateVariantsHandler,
  getTemplateVariantHandler,
  createTemplateVariantHandler,
  updateTemplateVariantHandler,
  deleteTemplateVariantHandler,
  getTemplateABTestReportHandler,
  getTemplateVariantResultsHandler,
  promoteTemplateWinnerHandler,
} from './template-ab.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

// ── Variant CRUD ──────────────────────────────────────────────────────────

router.get('/templates/:templateId/variants', wrap(listTemplateVariantsHandler));
router.get('/template-variants/:variantId', wrap(getTemplateVariantHandler));
router.post(
  '/templates/:templateId/variants',
  authorize('admin', 'manager', 'marketing'),
  wrap(createTemplateVariantHandler),
);
router.put(
  '/template-variants/:variantId',
  authorize('admin', 'manager', 'marketing'),
  wrap(updateTemplateVariantHandler),
);
router.delete(
  '/template-variants/:variantId',
  authorize('admin', 'manager'),
  wrap(deleteTemplateVariantHandler),
);

// ── Reports ───────────────────────────────────────────────────────────────

router.get('/templates/:templateId/report', wrap(getTemplateABTestReportHandler));
router.get('/template-variants/:variantId/results', wrap(getTemplateVariantResultsHandler));
router.post(
  '/templates/:templateId/promote-winner',
  authorize('admin', 'manager'),
  wrap(promoteTemplateWinnerHandler),
);

export { router as templateAbRoutes };
