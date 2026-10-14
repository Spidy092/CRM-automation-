import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listConfigsHandler,
  getConfigHandler,
  createConfigHandler,
  updateConfigHandler,
  deleteConfigHandler,
  triggerScrapeHandler,
  listLogsHandler,
  detectSelectorsHandler,
  discoverPagesHandler,
  getRunLeadsHandler,
  retryFailedHandler,
  importSelectedHandler,
  getStatsSummaryHandler,
  exportRunLeadsCsvHandler,
  getGroupsHandler,
  getTrendsHandler,
} from './scraper.controller';

const router = Router();

router.use(wrap(authenticate), authenticatedLimiter);

// Aggregate dashboard stats — same viewer roles as the config list.
router.get(
  '/stats/summary',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getStatsSummaryHandler),
);

// All authenticated roles can view scraper configs
router.get(
  '/',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(listConfigsHandler),
);

// List distinct group names — all authenticated roles.
// MUST be registered before /:id so Express does not treat "groups" as a
// config ID and route this to getConfigHandler.
router.get(
  '/groups',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getGroupsHandler),
);

// Trend data for charts — all authenticated roles.
// MUST be registered before /:id for the same reason as /groups.
router.get(
  '/trends',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getTrendsHandler),
);

router.get(
  '/:id',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getConfigHandler),
);

// AI-assisted selector detection — admin only (calls the configured LLM)
router.post('/detect-selectors', authorize('admin'), wrap(detectSelectorsHandler));

// Discover a site's pages by rendering it and reading its nav links — admin
// only (launches a real headless browser).
router.post('/discover-pages', authorize('admin'), wrap(discoverPagesHandler));

// Only admin can create/update/delete scraper configs
router.post('/', authorize('admin'), wrap(createConfigHandler));
router.put('/:id', authorize('admin'), wrap(updateConfigHandler));
router.delete('/:id', authorize('admin'), wrap(deleteConfigHandler));

// Trigger a scrape run — admin only
router.post('/:configId/scrape', authorize('admin'), wrap(triggerScrapeHandler));

// View logs — admin and manager
router.get('/:configId/logs', authorize('admin', 'manager'), wrap(listLogsHandler));

// Leads created by a specific run — admin and manager (same as viewing logs)
router.get('/logs/:logId/leads', authorize('admin', 'manager'), wrap(getRunLeadsHandler));

// Retry just the records that failed on a run — admin only (triggers a new run)
router.post('/logs/:logId/retry-failed', authorize('admin'), wrap(retryFailedHandler));

// Import an explicit selection from a review-staged run — admin only
// (creates leads; idempotent, never campaigns or messages).
router.post('/logs/:logId/import-selected', authorize('admin'), wrap(importSelectedHandler));

// Export leads from a run as CSV — admin and manager
router.get('/logs/:logId/export', authorize('admin', 'manager'), wrap(exportRunLeadsCsvHandler));

export { router as scraperRoutes };
