import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  classifyReplyHandler,
  getReplyHistoryHandler,
  triggerReplyClassificationHandler,
} from './ai-reply.controller';

const router = Router();

router.post(
  '/classify',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  classifyReplyHandler,
);

router.get(
  '/history',
  authenticate,
  authorize('admin', 'manager', 'sales', 'viewer'),
  getReplyHistoryHandler,
);

router.post(
  '/trigger/:leadId',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing'),
  triggerReplyClassificationHandler,
);

export default router;
