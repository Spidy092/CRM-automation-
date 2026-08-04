import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter, publicLimiter } from '../../shared/middleware/rateLimiter';
import {
  listFormsHandler,
  getFormHandler,
  createFormHandler,
  updateFormHandler,
  deleteFormHandler,
  getFormAnalyticsHandler,
  getEmbedSnippetHandler,
  getPublicFormHandler,
  submitFormHandler,
} from './forms.controller';

const router = Router();

// ── Admin Routes (authenticated) ──────────────────────────────────────────

router.use('/admin', wrap(authenticate), authenticatedLimiter);

router.get('/admin', authorize('admin', 'manager', 'marketing'), wrap(listFormsHandler));
router.get('/admin/:formId', authorize('admin', 'manager', 'marketing'), wrap(getFormHandler));
router.post('/admin', authorize('admin', 'manager', 'marketing'), wrap(createFormHandler));
router.put('/admin/:formId', authorize('admin', 'manager', 'marketing'), wrap(updateFormHandler));
router.delete('/admin/:formId', authorize('admin', 'manager'), wrap(deleteFormHandler));
router.get(
  '/admin/:formId/analytics',
  authorize('admin', 'manager', 'marketing'),
  wrap(getFormAnalyticsHandler),
);
router.get(
  '/admin/:formId/embed',
  authorize('admin', 'manager', 'marketing'),
  wrap(getEmbedSnippetHandler),
);

// ── Public Routes (no auth) ──────────────────────────────────────────────

router.get('/:slug', publicLimiter, wrap(getPublicFormHandler));
router.post('/:formId/submit', publicLimiter, wrap(submitFormHandler));

export { router as formsRoutes };
