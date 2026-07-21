import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listCampaignsHandler,
  getCampaignHandler,
  createCampaignHandler,
  updateCampaignHandler,
  deleteCampaignHandler,
  automationPreviewHandler,
  launchCampaignHandler,
  pauseCampaignHandler,
  resumeCampaignHandler,
  addLeadsHandler,
  removeLeadHandler,
  listCampaignLeadsHandler,
  getCampaignStatsHandler,
  getCampaignStepStatsHandler,
  retryLeadOutreachStepHandler,
} from './campaigns.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get('/', wrap(listCampaignsHandler));
router.get('/:id', wrap(getCampaignHandler));
router.post('/', authorize('admin', 'manager', 'marketing'), wrap(createCampaignHandler));
router.put('/:id', authorize('admin', 'manager', 'marketing'), wrap(updateCampaignHandler));
router.delete('/:id', authorize('admin', 'manager'), wrap(deleteCampaignHandler));

router.get(
  '/:id/automation-preview',
  authorize('admin', 'manager'),
  wrap(automationPreviewHandler),
);
router.post('/:id/launch', authorize('admin', 'manager'), wrap(launchCampaignHandler));
router.post('/:id/pause', authorize('admin', 'manager'), wrap(pauseCampaignHandler));
router.post('/:id/resume', authorize('admin', 'manager'), wrap(resumeCampaignHandler));

router.post('/:id/leads', authorize('admin', 'manager', 'marketing'), wrap(addLeadsHandler));
router.delete(
  '/:id/leads/:leadId',
  authorize('admin', 'manager', 'marketing'),
  wrap(removeLeadHandler),
);
router.get('/:id/leads', wrap(listCampaignLeadsHandler));
router.get('/:id/stats', wrap(getCampaignStatsHandler));
router.get('/:id/stats/steps', wrap(getCampaignStepStatsHandler));
router.post(
  '/:id/leads/:leadId/retry',
  authorize('admin', 'manager', 'sales'),
  wrap(retryLeadOutreachStepHandler),
);

export { router as campaignsRoutes };
