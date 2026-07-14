import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listReportsHandler,
  getDashboardHandler,
  getLeadGenerationReportHandler,
  getOutreachReportHandler,
  getPipelineReportHandler,
  getSalesRepReportHandler,
  getCampaignAnalyticsReportHandler,
  getIntegrationHealthReportHandler,
  exportReportHandler,
  downloadExportHandler,
} from './reports.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get(
  '/',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(listReportsHandler),
);
router.get(
  '/dashboard',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getDashboardHandler),
);
router.get(
  '/leads',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getLeadGenerationReportHandler),
);
router.get(
  '/outreach',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getOutreachReportHandler),
);
router.get(
  '/pipeline',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getPipelineReportHandler),
);
router.get(
  '/reps',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getSalesRepReportHandler),
);
router.get(
  '/campaigns',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getCampaignAnalyticsReportHandler),
);
router.get(
  '/integrations',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getIntegrationHealthReportHandler),
);
router.post(
  '/export',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(exportReportHandler),
);
router.get(
  '/export/:jobId/download',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(downloadExportHandler),
);

export { router as reportsRoutes };
