import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { leadImportUpload } from '../../shared/middleware/upload';
import {
  createLeadHandler,
  deleteLeadHandler,
  getLeadActivityHandler,
  getLeadHandler,
  importLeadsHandler,
  listLeadsHandler,
  pauseLeadHandler,
  updateLeadHandler,
  enrichLeadHandler,
  bulkClassifyHandler,
} from './leads.controller';

const router = Router();

// All lead routes require authentication + authenticated-tier rate limit.
router.use(authenticate, authenticatedLimiter);

// GET /api/v1/leads — admin/manager/sales/viewer only; marketing excluded per RBAC spec.
router.get('/', authorize('admin', 'manager', 'sales', 'viewer'), wrap(listLeadsHandler));
router.get('/:id', authorize('admin', 'manager', 'sales', 'viewer'), wrap(getLeadHandler));

// Create — Admin, Manager.
router.post('/', authorize('admin', 'manager'), wrap(createLeadHandler));

// Update — Admin, Manager, Sales (sales: own only, enforced in service).
router.put('/:id', authorize('admin', 'manager', 'sales'), wrap(updateLeadHandler));

// Soft-delete — Admin only.
router.delete('/:id', authorize('admin'), wrap(deleteLeadHandler));

// Bulk import — Admin, Manager.
router.post(
  '/import',
  authorize('admin', 'manager'),
  leadImportUpload.single('file'),
  wrap(importLeadsHandler),
);

// Activity timeline — Admin, Manager, Sales, Viewer.
router.get(
  '/:id/activity',
  authorize('admin', 'manager', 'sales', 'viewer'),
  wrap(getLeadActivityHandler),
);

// Pause/resume outreach — Sales, Manager, Admin (sales: own only, enforced in service).
router.post('/:id/pause', authorize('admin', 'manager', 'sales'), wrap(pauseLeadHandler));

// Enrich data using Hunter.io — Admin, Manager, Sales
router.post('/:id/enrich', authorize('admin', 'manager', 'sales'), wrap(enrichLeadHandler));

// Bulk classify — Admin, Manager only.
router.post('/bulk-classify', authorize('admin', 'manager'), wrap(bulkClassifyHandler));

export { router as leadsRoutes };
