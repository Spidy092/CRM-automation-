import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { leadImportUpload } from '../../shared/middleware/upload';
import {
  createLeadHandler,
  deleteLeadHandler,
  getLeadHandler,
  importLeadsHandler,
  listLeadsHandler,
  pauseLeadHandler,
  updateLeadHandler,
} from './leads.controller';

const router = Router();

// All lead routes require authentication + authenticated-tier rate limit.
router.use(authenticate, authenticatedLimiter);

// GET /api/v1/leads — All roles (sales are auto-scoped to own leads).
router.get('/', wrap(listLeadsHandler));
router.get('/:id', wrap(getLeadHandler));

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

// Pause/resume outreach — Sales, Manager, Admin (sales: own only, enforced in service).
router.post('/:id/pause', authorize('admin', 'manager', 'sales'), wrap(pauseLeadHandler));

export { router as leadsRoutes };
