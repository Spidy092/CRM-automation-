import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap } from '../../shared/utils/asyncHandler';
import {
  classifyReplyHandler,
  getReplyHistoryHandler,
  triggerReplyClassificationHandler,
} from './ai-reply.controller';

const router = Router();

router.post(
  '/classify',
  wrap(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing'),
  classifyReplyHandler,
);

router.get(
  '/history',
  wrap(authenticate),
  authorize('admin', 'manager', 'sales', 'viewer'),
  getReplyHistoryHandler,
);

router.post(
  '/trigger/:leadId',
  wrap(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing'),
  triggerReplyClassificationHandler,
);

export default router;
