import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { getLeadProfile, getLeadDecisionLog, getDecisionLog } from './ai-intelligence.controller';

const router = Router();

// Read a lead's AI profile — any lead-facing role
router.get(
  '/leads/:leadId/profile',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  getLeadProfile,
);

// Read a lead's AI decision log
router.get(
  '/leads/:leadId/decisions',
  authenticate,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  getLeadDecisionLog,
);

// Global AI decision audit trail — admin only
router.get('/decisions', authenticate, authorize('admin'), getDecisionLog);

export default router;
