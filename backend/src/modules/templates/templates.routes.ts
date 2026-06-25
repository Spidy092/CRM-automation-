import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  approveTemplateHandler,
  deleteTemplateHandler,
} from './templates.controller';

const router = Router();

router.use(authenticate);

// Anyone authenticated can read.
router.get('/', wrap(listTemplatesHandler));
router.get('/:id', wrap(getTemplateHandler));

// Admin or marketing may create, update, approve, and delete templates.
// Per AGENTS.md RBAC reference: marketing role manages campaigns, templates, reports.
router.post('/', authorize('admin', 'marketing'), wrap(createTemplateHandler));
router.put('/:id', authorize('admin', 'marketing'), wrap(updateTemplateHandler));
router.post('/:id/approve', authorize('admin', 'marketing'), wrap(approveTemplateHandler));
router.delete('/:id', authorize('admin', 'marketing'), wrap(deleteTemplateHandler));

export { router as templatesRoutes };
