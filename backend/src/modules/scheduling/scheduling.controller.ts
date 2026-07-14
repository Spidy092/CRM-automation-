/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- TODO: refactor away from `any` casts (legacy debt) */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import * as schedulingService from './scheduling.service';
import {
  bulkAvailabilitySchema,
  createBookingUrlSchema,
  updateBookingUrlSchema,
  createBookingSchema,
  bookingUrlSlugParamSchema,
  bookingIdParamSchema,
  availabilityQuerySchema,
} from './scheduling.schema';

// ── Availability ─────────────────────────────────────────────────────────

export async function getAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const availability = await schedulingService.getUserAvailability(userId);
    sendSuccess(res, availability);
  } catch (err) {
    next(err);
  }
}

export async function setAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const body = bulkAvailabilitySchema.parse(req.body);
    const availability = await schedulingService.setAvailability(userId, body.slots, userId);
    sendSuccess(res, availability);
  } catch (err) {
    next(err);
  }
}

export async function getAvailableSlotsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { date, userId } = availabilityQuerySchema.parse(req.query);
    const targetUserId = userId ?? (req as any).user.id;
    const slots = await schedulingService.getAvailableSlots(targetUserId, date);
    sendSuccess(res, slots);
  } catch (err) {
    next(err);
  }
}

// ── Booking URLs ─────────────────────────────────────────────────────────

export async function listBookingUrlsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const urls = await schedulingService.listBookingUrls(userId);
    sendSuccess(res, urls);
  } catch (err) {
    next(err);
  }
}

export async function getBookingUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const urls = await schedulingService.listBookingUrls(userId);
    const url = urls.find((u) => u.id === id);
    if (!url) {
      res.status(404).json({ success: false, error: 'Booking URL not found' });
      return;
    }
    sendSuccess(res, url);
  } catch (err) {
    next(err);
  }
}

export async function createBookingUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const body = createBookingUrlSchema.parse(req.body);
    const url = await schedulingService.createBookingUrl(userId, body);
    sendSuccess(res, url, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateBookingUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const body = updateBookingUrlSchema.parse(req.body);
    const url = await schedulingService.updateBookingUrlById(id, body, userId);
    sendSuccess(res, url);
  } catch (err) {
    next(err);
  }
}

// ── Public Booking Page ──────────────────────────────────────────────────

export async function getPublicBookingPageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { slug } = bookingUrlSlugParamSchema.parse(req.params);
    const url = await schedulingService.getBookingUrlBySlug(slug);
    sendSuccess(res, {
      ...url,
      userId: undefined,
      isPublic: true,
    });
  } catch (err) {
    next(err);
  }
}

export async function getPublicAvailableSlotsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { slug } = bookingUrlSlugParamSchema.parse(req.params);
    const { date } = availabilityQuerySchema.parse(req.query);

    const url = await schedulingService.getBookingUrlBySlug(slug);
    const slots = await schedulingService.getAvailableSlots(url.user_id, date);
    sendSuccess(res, slots);
  } catch (err) {
    next(err);
  }
}

export async function createPublicBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { slug } = bookingUrlSlugParamSchema.parse(req.params);
    const body = createBookingSchema.parse(req.body);
    const booking = await schedulingService.createBooking(slug, body);
    sendSuccess(res, booking, 201);
  } catch (err) {
    next(err);
  }
}

// ── Bookings (authenticated) ────────────────────────────────────────────

export async function listBookingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const bookings = await schedulingService.listBookings(userId);
    sendSuccess(res, bookings);
  } catch (err) {
    next(err);
  }
}

export async function cancelBookingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const booking = await schedulingService.cancelBooking(bookingId, userId);
    sendSuccess(res, booking);
  } catch (err) {
    next(err);
  }
}

// ── Round Robin ──────────────────────────────────────────────────────────

export async function getRoundRobinUserHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = await schedulingService.getRoundRobinUser();
    sendSuccess(res, { userId });
  } catch (err) {
    next(err);
  }
}
