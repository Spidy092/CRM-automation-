import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  Availability,
  BookingUrl,
  Booking,
  DateAvailability,
  TimeSlot,
  CreateBookingUrlInput,
  UpdateBookingUrlInput,
  CreateBookingInput,
} from './scheduling.types';
import * as repo from './scheduling.repository';
import { createEvent } from '../integrations/google-calendar/google-calendar.connector';

// ── Availability ─────────────────────────────────────────────────────────

export async function getUserAvailability(userId: string): Promise<Availability[]> {
  return repo.findAvailabilityByUser(userId);
}

export async function setAvailability(
  userId: string,
  slots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotDurationMin: number;
    isActive: boolean;
  }>,
  actorId: string,
): Promise<Availability[]> {
  await repo.upsertAvailability(userId, slots);

  await writeAuditLog({
    userId: actorId,
    action: 'scheduling.availability.updated',
    entityType: 'user',
    entityId: userId,
    newValue: { slotCount: slots.length },
    ipAddress: null,
  });

  return repo.findAvailabilityByUser(userId);
}

// ── Available Slots ──────────────────────────────────────────────────────

export async function getAvailableSlots(userId: string, date: string): Promise<DateAvailability> {
  const dateObj = new Date(date + 'T00:00:00Z');
  const dayOfWeek = dateObj.getUTCDay();

  const availability = await repo.findAvailabilityByUserAndDay(userId, dayOfWeek);
  if (availability.length === 0) {
    return { date, slots: [] };
  }

  // Get existing bookings for this date
  const startOfDay = date + 'T00:00:00Z';
  const endOfDay = date + 'T23:59:59Z';
  const existingBookings = await repo.findBookingsByUserAndDateRange(userId, startOfDay, endOfDay);

  // Generate time slots
  const slots: TimeSlot[] = [];

  for (const avail of availability) {
    const [startHour, startMin] = avail.start_time.split(':').map(Number);
    const [endHour, endMin] = avail.end_time.split(':').map(Number);

    let currentMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    while (currentMinutes + avail.slot_duration_min <= endMinutes) {
      const slotStart = new Date(dateObj);
      slotStart.setUTCHours(Math.floor(currentMinutes / 60), currentMinutes % 60, 0, 0);

      const slotEnd = new Date(slotStart);
      slotEnd.setUTCMinutes(slotEnd.getUTCMinutes() + avail.slot_duration_min);

      const slotStartISO = slotStart.toISOString();
      const slotEndISO = slotEnd.toISOString();

      // Check for conflicts
      const hasConflict = existingBookings.some(
        (b) => new Date(b.starts_at) < slotEnd && new Date(b.ends_at) > slotStart,
      );

      slots.push({
        start: slotStartISO,
        end: slotEndISO,
        available: !hasConflict,
      });

      currentMinutes += avail.slot_duration_min;
    }
  }

  return { date, slots };
}

// ── Booking URLs ─────────────────────────────────────────────────────────

export async function listBookingUrls(userId: string): Promise<BookingUrl[]> {
  return repo.findBookingUrlsByUser(userId);
}

export async function getBookingUrlBySlug(slug: string): Promise<BookingUrl> {
  const url = await repo.findBookingUrlBySlug(slug);
  if (!url) throw new AppError('Booking page not found', 404);
  return url;
}

export async function createBookingUrl(
  userId: string,
  input: CreateBookingUrlInput,
): Promise<BookingUrl> {
  // Generate unique slug
  const baseSlug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  let slug = baseSlug;
  let counter = 1;
  // eslint-disable-next-line no-constant-condition -- intentional loop with break
  while (true) {
    const existing = await repo.findBookingUrlBySlug(slug);
    if (!existing) break;
    slug = `${baseSlug}-${counter++}`;
  }

  const url = await repo.insertBookingUrl({
    user_id: userId,
    slug,
    title: input.title,
    description: input.description,
    location_type: input.locationType ?? 'google_meet',
    location_details: input.locationDetails,
    buffer_before_min: input.bufferBeforeMin ?? 0,
    buffer_after_min: input.bufferAfterMin ?? 0,
    max_advance_days: input.maxAdvanceDays ?? 30,
  });

  await writeAuditLog({
    userId,
    action: 'scheduling.booking_url.created',
    entityType: 'booking_url',
    entityId: url.id,
    newValue: { slug, title: url.title },
    ipAddress: null,
  });

  return url;
}

export async function updateBookingUrlById(
  urlId: string,
  input: UpdateBookingUrlInput,
  actorId: string,
): Promise<BookingUrl> {
  const url = await repo.updateBookingUrl(urlId, {
    title: input.title,
    description: input.description,
    location_type: input.locationType,
    location_details: input.locationDetails,
    buffer_before_min: input.bufferBeforeMin,
    buffer_after_min: input.bufferAfterMin,
    max_advance_days: input.maxAdvanceDays,
    is_active: input.isActive,
  });

  await writeAuditLog({
    userId: actorId,
    action: 'scheduling.booking_url.updated',
    entityType: 'booking_url',
    entityId: urlId,
    ipAddress: null,
  });

  return url;
}

// ── Bookings ─────────────────────────────────────────────────────────────

export async function listBookings(userId: string): Promise<Booking[]> {
  return repo.findBookingsByUser(userId);
}

export async function createBooking(slug: string, input: CreateBookingInput): Promise<Booking> {
  const bookingUrl = await repo.findBookingUrlBySlug(slug);
  if (!bookingUrl) throw new AppError('Booking page not found', 404);

  // Validate slot is in the future
  const startsAt = new Date(input.startsAt);
  if (startsAt <= new Date()) {
    throw new AppError('Booking time must be in the future', 400);
  }

  // Validate max advance days
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + bookingUrl.max_advance_days);
  if (startsAt > maxDate) {
    throw new AppError(`Cannot book more than ${bookingUrl.max_advance_days} days in advance`, 400);
  }

  // Calculate end time (30 min default)
  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

  // Check for conflicts
  const conflicts = await repo.findConflictingBookings(
    bookingUrl.user_id,
    startsAt.toISOString(),
    endsAt.toISOString(),
  );
  if (conflicts.length > 0) {
    throw new AppError('This time slot is no longer available', 409);
  }

  // Try to create Google Calendar event
  let googleEventId: string | null = null;
  let meetingUrl: string | null = null;

  try {
    const eventResult = await createEvent({
      summary: `Meeting with ${input.bookerName}`,
      description: input.notes ?? `Booked via ${bookingUrl.title}`,
      startAt: startsAt.toISOString(),
      endAt: endsAt.toISOString(),
      attendees: [input.bookerEmail],
    });

    if (eventResult.ok) {
      googleEventId = eventResult.eventId;
      meetingUrl = eventResult.htmlLink;
    } else {
      logger.warn('Failed to create Google Calendar event for booking', {
        error: eventResult.error,
        bookingUrlId: bookingUrl.id,
      });
    }
  } catch (err) {
    logger.warn('Google Calendar event creation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Create booking
  const booking = await repo.insertBooking({
    booking_url_id: bookingUrl.id,
    user_id: bookingUrl.user_id,
    lead_id: input.leadId ?? null,
    booker_name: input.bookerName,
    booker_email: input.bookerEmail,
    booker_phone: input.bookerPhone ?? null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    meeting_url: meetingUrl,
    notes: input.notes ?? null,
    google_event_id: googleEventId,
  });

  await writeAuditLog({
    userId: bookingUrl.user_id,
    action: 'scheduling.booking.created',
    entityType: 'booking',
    entityId: booking.id,
    newValue: {
      booker: input.bookerName,
      email: input.bookerEmail,
      starts_at: startsAt.toISOString(),
    },
    ipAddress: null,
  });

  logger.info('Booking created', {
    bookingId: booking.id,
    userId: bookingUrl.user_id,
    bookerEmail: input.bookerEmail,
    startsAt: startsAt.toISOString(),
  });

  return booking;
}

export async function cancelBooking(bookingId: string, actorId: string): Promise<Booking> {
  const booking = await repo.findBookingById(bookingId);
  if (!booking) throw new AppError('Booking not found', 404);

  const updated = await repo.updateBookingStatus(bookingId, 'cancelled');

  // Cancel Google Calendar event if exists
  if (booking.google_event_id) {
    try {
      // Google Calendar cancel would go here — for now just log
      logger.info('Would cancel Google Calendar event', {
        eventId: booking.google_event_id,
      });
    } catch (err) {
      logger.warn('Failed to cancel Google Calendar event', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await writeAuditLog({
    userId: actorId,
    action: 'scheduling.booking.cancelled',
    entityType: 'booking',
    entityId: bookingId,
    ipAddress: null,
  });

  return updated;
}

// ── Round Robin ──────────────────────────────────────────────────────────

export async function getRoundRobinUser(): Promise<string | null> {
  const users = await repo.getAllBookingUrlUsers();
  if (users.length === 0) return null;

  const lastBookedUserId = await repo.getLastBookedUser();

  if (!lastBookedUserId) return users[0].user_id;

  const lastIndex = users.findIndex((u) => u.user_id === lastBookedUserId);
  const nextIndex = (lastIndex + 1) % users.length;
  return users[nextIndex].user_id;
}
