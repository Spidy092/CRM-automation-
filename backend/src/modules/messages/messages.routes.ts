import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  listMessageSnippetsHandler,
  getMessageSnippetHandler,
  createMessageSnippetHandler,
  updateMessageSnippetHandler,
  deleteMessageSnippetHandler,
} from './messages.controller';

const router = Router();

router.use(authenticate);

// Anyone authenticated can read the shared snippet library.
router.get('/', wrap(listMessageSnippetsHandler));
router.get('/:id', wrap(getMessageSnippetHandler));

// Admin or marketing may create, update, and delete snippets.
// Per AGENTS.md RBAC reference: marketing role manages campaigns, templates, reports.
router.post('/', authorize('admin', 'marketing'), wrap(createMessageSnippetHandler));
router.put('/:id', authorize('admin', 'marketing'), wrap(updateMessageSnippetHandler));
router.delete('/:id', authorize('admin', 'marketing'), wrap(deleteMessageSnippetHandler));

export { router as messagesRoutes };
