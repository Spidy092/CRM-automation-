import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { templateAttachmentUpload } from '../../shared/middleware/upload';
import {
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  approveTemplateHandler,
  deleteTemplateHandler,
  addTemplateAttachmentHandler,
  addTemplateAttachmentFromLibraryHandler,
  removeTemplateAttachmentHandler,
  duplicateTemplateHandler,
  archiveTemplateHandler,
  unarchiveTemplateHandler,
  renameTemplateHandler,
  previewTemplateHandler,
  testSendTemplateHandler,
} from './templates.controller';

const router = Router();

router.use(wrap(authenticate));

// Anyone authenticated can read.
router.get('/', wrap(listTemplatesHandler));
router.get('/:id', wrap(getTemplateHandler));

// Admin or marketing may create, update, approve, and delete templates.
// Per AGENTS.md RBAC reference: marketing role manages campaigns, templates, reports.
router.post('/', authorize('admin', 'marketing'), wrap(createTemplateHandler));
router.put('/:id', authorize('admin', 'marketing'), wrap(updateTemplateHandler));
router.post('/:id/approve', authorize('admin', 'marketing'), wrap(approveTemplateHandler));
router.delete('/:id', authorize('admin', 'marketing'), wrap(deleteTemplateHandler));

// Gallery actions — same write RBAC as create/update (no new privilege level).
router.post('/:id/duplicate', authorize('admin', 'marketing'), wrap(duplicateTemplateHandler));
router.post('/:id/archive', authorize('admin', 'marketing'), wrap(archiveTemplateHandler));
router.post('/:id/unarchive', authorize('admin', 'marketing'), wrap(unarchiveTemplateHandler));
router.patch('/:id/rename', authorize('admin', 'marketing'), wrap(renameTemplateHandler));

// Preview is read-only (any authenticated user); test-send dispatches real
// email so it requires the same write RBAC and an explicit recipient.
router.post('/:id/preview', wrap(previewTemplateHandler));
router.post('/:id/test-send', authorize('admin', 'marketing'), wrap(testSendTemplateHandler));

router.post(
  '/:id/attachments',
  authorize('admin', 'marketing'),
  templateAttachmentUpload.single('file'),
  wrap(addTemplateAttachmentHandler),
);
router.post(
  '/:id/attachments/from-library',
  authorize('admin', 'marketing'),
  wrap(addTemplateAttachmentFromLibraryHandler),
);
router.delete(
  '/:id/attachments/:attachmentId',
  authorize('admin', 'marketing'),
  wrap(removeTemplateAttachmentHandler),
);

export { router as templatesRoutes };
