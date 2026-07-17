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
  getStatsSummaryHandler,
} from './scraper.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

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

export { router as scraperRoutes };
