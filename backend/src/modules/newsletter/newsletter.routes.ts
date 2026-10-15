import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter, publicLimiter } from '../../shared/middleware/rateLimiter';
import {
  addNewsletterContactsHandler,
  subscribeHandler,
  confirmHandler,
  unsubscribeHandler,
  getPreferencesHandler,
  updatePreferencesHandler,
  listSubscribersHandler,
  getSubscriberHandler,
  broadcastHandler,
  toggleAutomatedDigestHandler,
  getDigestConfigHandler,
  updateDigestConfigHandler,
  getSubscriberCountsHandler,
  getEligibleCountHandler,
  testSendHandler,
  exportSubscribersHandler,
  getDigestStatusHandler,
  getDigestDraftHandler,
  saveDigestDraftHandler,
  approveDigestDraftHandler,
  setDigestAutoSendHandler,
  listBroadcastsHandler,
  retryBroadcastHandler,
  listUncertainRecipientsHandler,
} from './newsletter.controller';

const router = Router();

// ── Public Routes (no auth) ──────────────────────────────────────────────

router.post('/subscribe', publicLimiter, wrap(subscribeHandler));
router.get('/confirm', publicLimiter, wrap(confirmHandler));
router.post('/unsubscribe', publicLimiter, wrap(unsubscribeHandler));
router.get('/preferences', publicLimiter, wrap(getPreferencesHandler));
router.patch('/preferences', publicLimiter, wrap(updatePreferencesHandler));

// ── Admin Routes (authenticated) ─────────────────────────────────────────

router.use('/admin', wrap(authenticate), authenticatedLimiter, authorize('admin', 'marketing'));
// Lead access is restricted to admins here; marketing cannot browse CRM leads.
router.post('/admin/contacts', authorize('admin'), wrap(addNewsletterContactsHandler));
router.get('/admin/subscribers', wrap(listSubscribersHandler));
router.get('/admin/subscribers/counts', wrap(getSubscriberCountsHandler));
router.get('/admin/subscribers/export', wrap(exportSubscribersHandler));
router.get('/admin/subscribers/:id', wrap(getSubscriberHandler));
router.get('/admin/eligible-count', wrap(getEligibleCountHandler));
router.get('/admin/broadcasts', wrap(listBroadcastsHandler));
router.post('/admin/broadcasts/:id/retry-failed', wrap(retryBroadcastHandler));
router.get('/admin/broadcasts/:id/uncertain-recipients', wrap(listUncertainRecipientsHandler));
router.post('/admin/broadcast', wrap(broadcastHandler));
router.post('/admin/test-send', wrap(testSendHandler));
router.post('/admin/automated-digest', wrap(toggleAutomatedDigestHandler));
router.get('/admin/digest-status', wrap(getDigestStatusHandler));
router.get('/admin/digest-config', wrap(getDigestConfigHandler));
router.put('/admin/digest-config', wrap(updateDigestConfigHandler));
router.get('/admin/digest-draft', wrap(getDigestDraftHandler));
router.post('/admin/digest-draft', wrap(saveDigestDraftHandler));
router.post('/admin/digest-draft/approve', wrap(approveDigestDraftHandler));
router.post('/admin/digest-auto-send', wrap(setDigestAutoSendHandler));

export { router as newsletterRoutes };
