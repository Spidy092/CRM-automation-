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
} from './scraper.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

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

// Only admin can create/update/delete scraper configs
router.post('/', authorize('admin'), wrap(createConfigHandler));
router.put('/:id', authorize('admin'), wrap(updateConfigHandler));
router.delete('/:id', authorize('admin'), wrap(deleteConfigHandler));

// Trigger a scrape run — admin only
router.post('/:configId/scrape', authorize('admin'), wrap(triggerScrapeHandler));

// View logs — admin and manager
router.get('/:configId/logs', authorize('admin', 'manager'), wrap(listLogsHandler));

export { router as scraperRoutes };
