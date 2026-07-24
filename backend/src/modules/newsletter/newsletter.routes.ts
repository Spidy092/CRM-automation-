import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter, publicLimiter } from '../../shared/middleware/rateLimiter';
import {
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
} from './newsletter.controller';

const router = Router();

// ── Public Routes (no auth) ──────────────────────────────────────────────

router.post('/subscribe', publicLimiter, wrap(subscribeHandler));
router.get('/confirm', publicLimiter, wrap(confirmHandler));
router.get('/unsubscribe', publicLimiter, wrap(unsubscribeHandler));
router.get('/preferences', publicLimiter, wrap(getPreferencesHandler));
router.patch('/preferences', publicLimiter, wrap(updatePreferencesHandler));

// ── Admin Routes (authenticated) ─────────────────────────────────────────

router.use('/admin', authenticate, authenticatedLimiter, authorize('admin', 'marketing'));
router.get('/admin/subscribers', wrap(listSubscribersHandler));
router.get('/admin/subscribers/:id', wrap(getSubscriberHandler));
router.post('/admin/broadcast', wrap(broadcastHandler));
router.post('/admin/automated-digest', wrap(toggleAutomatedDigestHandler));
router.get('/admin/digest-config', wrap(getDigestConfigHandler));
router.put('/admin/digest-config', wrap(updateDigestConfigHandler));

export { router as newsletterRoutes };
