import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';
import { getHistory, sendMessage } from './chat.controller';

const router = Router();

router.post(
  '/',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(sendMessage),
);
router.get(
  '/history/:conversationId',
  asyncHandler(authenticate),
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(getHistory),
);

export default router;
