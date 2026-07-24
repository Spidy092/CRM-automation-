import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { fileLibraryUpload } from '../../shared/middleware/upload';
import {
  listFilesHandler,
  getFileHandler,
  uploadFileHandler,
  updateFileHandler,
  deleteFileHandler,
} from './files.controller';

const router = Router();

router.use(authenticate);

// Anyone authenticated can read the shared file library.
router.get('/', wrap(listFilesHandler));
router.get('/:id', wrap(getFileHandler));

// Admin or marketing may upload, rename/retag, and delete files.
// Per AGENTS.md RBAC reference: marketing role manages campaigns, templates, reports.
router.post('/', authorize('admin', 'marketing'), fileLibraryUpload.single('file'), wrap(uploadFileHandler));
router.patch('/:id', authorize('admin', 'marketing'), wrap(updateFileHandler));
router.delete('/:id', authorize('admin', 'marketing'), wrap(deleteFileHandler));

export { router as filesRoutes };
