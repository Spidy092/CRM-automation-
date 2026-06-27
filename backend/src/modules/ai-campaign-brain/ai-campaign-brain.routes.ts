import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { getBrief, approveBriefHandler, rejectBriefHandler } from './ai-campaign-brain.controller';

const router = Router();

// Read a campaign's AI brief
router.get(
  '/campaigns/:campaignId/brief',
  authenticate,
  authorize('admin', 'manager', 'marketing', 'sales', 'viewer'),
  getBrief,
);

// Approve / reject a brief — managers and admins only
router.post(
  '/campaigns/:campaignId/brief/approve',
  authenticate,
  authorize('admin', 'manager'),
  approveBriefHandler,
);

router.post(
  '/campaigns/:campaignId/brief/reject',
  authenticate,
  authorize('admin', 'manager'),
  rejectBriefHandler,
);

export default router;
