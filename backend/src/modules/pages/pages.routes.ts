import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter, publicLimiter } from '../../shared/middleware/rateLimiter';
import {
  listPagesHandler,
  getPageHandler,
  getPageViewsHandler,
  createPageHandler,
  updatePageHandler,
  publishPageHandler,
  unpublishPageHandler,
  deletePageHandler,
  getPublicPageHandler,
} from './pages.controller';

const router = Router();

// ── Admin Routes (authenticated) ──────────────────────────────────────────

router.use('/admin', authenticate, authenticatedLimiter);

router.get('/admin', wrap(listPagesHandler));
router.get('/admin/:id', wrap(getPageHandler));
router.get('/admin/:id/views', wrap(getPageViewsHandler));
router.post('/admin', authorize('admin', 'marketing'), wrap(createPageHandler));
router.put('/admin/:id', authorize('admin', 'marketing'), wrap(updatePageHandler));
router.post('/admin/:id/publish', authorize('admin', 'marketing'), wrap(publishPageHandler));
router.post('/admin/:id/unpublish', authorize('admin', 'marketing'), wrap(unpublishPageHandler));
router.delete('/admin/:id', authorize('admin', 'marketing'), wrap(deletePageHandler));

// ── Public Routes (no auth) ────────────────────────────────────────────────

router.get('/:slug', publicLimiter, wrap(getPublicPageHandler));

export { router as pagesRoutes };
