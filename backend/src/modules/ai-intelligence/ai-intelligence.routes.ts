import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { getLeadProfile, getLeadDecisionLog, getDecisionLog } from './ai-intelligence.controller';
import { wrap as asyncHandler } from '../../shared/utils/asyncHandler';

const router = Router();

// Read a lead's AI profile — any lead-facing role
router.get(
  '/leads/:leadId/profile',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(getLeadProfile),
);

// Read a lead's AI decision log
router.get(
  '/leads/:leadId/decisions',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  asyncHandler(getLeadDecisionLog),
);

// Global AI decision audit trail — admin only
router.get('/decisions', authenticate, authorize('admin'), asyncHandler(getDecisionLog));

export default router;
