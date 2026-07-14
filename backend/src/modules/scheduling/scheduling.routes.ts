import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  getAvailabilityHandler,
  setAvailabilityHandler,
  getAvailableSlotsHandler,
  listBookingUrlsHandler,
  getBookingUrlHandler,
  createBookingUrlHandler,
  updateBookingUrlHandler,
  getPublicBookingPageHandler,
  getPublicAvailableSlotsHandler,
  createPublicBookingHandler,
  listBookingsHandler,
  cancelBookingHandler,
  getRoundRobinUserHandler,
} from './scheduling.controller';

const router = Router();

// ── Public Routes (no auth) ─────────────────────────────────────────────

router.get('/book/:slug', wrap(getPublicBookingPageHandler));
router.get('/book/:slug/slots', wrap(getPublicAvailableSlotsHandler));
router.post('/book/:slug', wrap(createPublicBookingHandler));

// ── Authenticated Routes ────────────────────────────────────────────────

router.use(authenticate, authenticatedLimiter);

// Availability
router.get('/availability', wrap(getAvailabilityHandler));
router.put('/availability', authorize('admin', 'manager', 'sales'), wrap(setAvailabilityHandler));
router.get('/availability/slots', wrap(getAvailableSlotsHandler));

// Booking URLs
router.get('/urls', wrap(listBookingUrlsHandler));
router.get('/urls/:id', wrap(getBookingUrlHandler));
router.post('/urls', authorize('admin', 'manager', 'sales'), wrap(createBookingUrlHandler));
router.put('/urls/:id', authorize('admin', 'manager', 'sales'), wrap(updateBookingUrlHandler));

// Bookings
router.get('/bookings', wrap(listBookingsHandler));
router.post('/bookings/:bookingId/cancel', wrap(cancelBookingHandler));

// Round Robin
router.get('/round-robin', authorize('admin', 'manager'), wrap(getRoundRobinUserHandler));

export { router as schedulingRoutes };
