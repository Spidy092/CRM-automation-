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
  for (const slot of slots) {
    if (slot.isActive && slot.startTime >= slot.endTime) {
      throw new AppError('Start time must be before end time', 400);
    }
  }

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

export async function getAvailableSlots(
  userId: string,
  date: string,
  slug?: string,
): Promise<DateAvailability> {
  // Fetch specific booking URL if slug provided
  let bookingUrl: BookingUrl | null = null;
  if (slug) {
    bookingUrl = await repo.findBookingUrlBySlug(slug);
    if (!bookingUrl || !bookingUrl.is_active) {
      throw new AppError('Booking page not found or inactive', 404);
    }
  }

  // Check date override (holidays/vacations)
  const dateOverride = await repo.findDateOverrideByUserAndDate(userId, date);
  if (dateOverride?.is_blocked) {
    return { date, slots: [] };
  }

  const dateObj = new Date(date + 'T00:00:00Z');
  const dayOfWeek = dateObj.getUTCDay();

  // Validate max advance days if bookingUrl exists
  const maxAdvanceDays = bookingUrl?.max_advance_days ?? 30;
  const maxAllowedDate = new Date();
  maxAllowedDate.setDate(maxAllowedDate.getDate() + maxAdvanceDays);
  if (dateObj > maxAllowedDate) {
    return { date, slots: [] };
  }

  let availability = await repo.findAvailabilityByUserAndDay(userId, dayOfWeek);

  // Apply custom time window override if set
  if (dateOverride && !dateOverride.is_blocked && dateOverride.start_time && dateOverride.end_time) {
    availability = [
      {
        id: 'override',
        user_id: userId,
        day_of_week: dayOfWeek,
        start_time: dateOverride.start_time,
        end_time: dateOverride.end_time,
        slot_duration_min: 30,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }

  if (availability.length === 0) {
    return { date, slots: [] };
  }

  // Fetch booking URL for buffer settings if not passed via slug
  if (!bookingUrl) {
    const urls = await repo.findBookingUrlsByUser(userId);
    bookingUrl = urls.find((u) => u.is_active) ?? null;
  }
  const bufferBeforeMs = (bookingUrl?.buffer_before_min ?? 0) * 60 * 1000;
  const bufferAfterMs = (bookingUrl?.buffer_after_min ?? 0) * 60 * 1000;

  // Get existing bookings for this date
  const startOfDay = date + 'T00:00:00Z';
  const endOfDay = date + 'T23:59:59Z';
  const existingBookings = await repo.findBookingsByUserAndDateRange(userId, startOfDay, endOfDay);

  const now = new Date();
  // Minimum advance notice (e.g. at least 2 hours notice)
  const minNoticeThreshold = new Date(now.getTime() + 2 * 60 * 60 * 1000);

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

      // Check if slot starts before minimum notice threshold
      const isTooSoon = slotStart < minNoticeThreshold;

      // Check for conflicts including buffer windows
      const hasConflict = existingBookings.some((b) => {
        const bStartWithBuffer = new Date(new Date(b.starts_at).getTime() - bufferBeforeMs);
        const bEndWithBuffer = new Date(new Date(b.ends_at).getTime() + bufferAfterMs);
        return bStartWithBuffer < slotEnd && bEndWithBuffer > slotStart;
      });

      slots.push({
        start: slotStartISO,
        end: slotEndISO,
        available: !isTooSoon && !hasConflict,
      });

      currentMinutes += avail.slot_duration_min;
    }
  }

  return { date, slots };
}

// ── Date Overrides ───────────────────────────────────────────────────────

export async function listDateOverrides(userId: string) {
  return repo.findDateOverridesByUser(userId);
}

export async function setDateOverride(
  userId: string,
  input: {
    overrideDate: string;
    isBlocked: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  },
  actorId: string,
) {
  const override = await repo.upsertDateOverride(userId, input);
  await writeAuditLog({
    userId: actorId,
    action: 'scheduling.date_override.updated',
    entityType: 'user',
    entityId: userId,
    newValue: { date: input.overrideDate, isBlocked: input.isBlocked },
    ipAddress: null,
  });
  return override;
}

export async function removeDateOverride(overrideId: string, userId: string) {
  await repo.deleteDateOverride(overrideId, userId);
  await writeAuditLog({
    userId,
    action: 'scheduling.date_override.deleted',
    entityType: 'user_date_override',
    entityId: overrideId,
    ipAddress: null,
  });
}

// ── Booking URLs ─────────────────────────────────────────────────────────

export async function listBookingUrls(userId: string): Promise<BookingUrl[]> {
  return repo.findBookingUrlsByUser(userId);
}

export async function getBookingUrlBySlug(slug: string): Promise<BookingUrl> {
  const url = await repo.findBookingUrlBySlug(slug);
  if (!url || !url.is_active) throw new AppError('Booking page not found or inactive', 404);
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
  if (!bookingUrl || !bookingUrl.is_active) throw new AppError('Booking page not found or inactive', 404);

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

  // Check date override (holidays / vacations)
  const dateStr = startsAt.toISOString().slice(0, 10);
  const dateOverride = await repo.findDateOverrideByUserAndDate(bookingUrl.user_id, dateStr);
  if (dateOverride?.is_blocked) {
    throw new AppError('This date is not available for booking', 409);
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

export async function createInternalBooking(
  userId: string,
  input: {
    leadId?: string;
    bookingUrlId?: string;
    bookerName: string;
    bookerEmail: string;
    bookerPhone?: string;
    startsAt: string;
    notes?: string;
    forceOverride?: boolean;
  },
): Promise<Booking> {
  const startsAt = new Date(input.startsAt);
  if (startsAt <= new Date()) {
    throw new AppError('Booking time must be in the future', 400);
  }

  const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

  // Check double booking conflicts
  const conflicts = await repo.findConflictingBookings(
    userId,
    startsAt.toISOString(),
    endsAt.toISOString(),
  );
  if (conflicts.length > 0) {
    throw new AppError('You already have a conflicting meeting at this time slot', 409);
  }

  // If not force overriding, check date blockouts
  if (!input.forceOverride) {
    const dateStr = startsAt.toISOString().slice(0, 10);
    const dateOverride = await repo.findDateOverrideByUserAndDate(userId, dateStr);
    if (dateOverride?.is_blocked) {
      throw new AppError(
        'This date is marked as blocked/holiday. Check "Force schedule outside standard availability" to override.',
        409,
      );
    }
  }

  // Find or fallback booking URL
  let bookingUrlId = input.bookingUrlId;
  if (!bookingUrlId) {
    const urls = await repo.findBookingUrlsByUser(userId);
    const activeUrl = urls.find((u) => u.is_active);
    if (!activeUrl) {
      throw new AppError('Please create a Booking Page first before scheduling meetings', 400);
    }
    bookingUrlId = activeUrl.id;
  }

  // Create Google Calendar event with attendee invite
  let googleEventId: string | null = null;
  let meetingUrl: string | null = null;

  try {
    const eventResult = await createEvent({
      summary: `Meeting with ${input.bookerName}`,
      description: input.notes ?? 'Scheduled via CRM Platform',
      startAt: startsAt.toISOString(),
      endAt: endsAt.toISOString(),
      attendees: [input.bookerEmail],
    });

    if (eventResult.ok) {
      googleEventId = eventResult.eventId;
      meetingUrl = eventResult.htmlLink;
    }
  } catch (err) {
    logger.warn('Google Calendar event creation failed during internal booking', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const booking = await repo.insertBooking({
    booking_url_id: bookingUrlId,
    user_id: userId,
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
    userId,
    action: 'scheduling.internal_booking.created',
    entityType: 'booking',
    entityId: booking.id,
    newValue: {
      booker: input.bookerName,
      email: input.bookerEmail,
      starts_at: startsAt.toISOString(),
      forceOverride: input.forceOverride ?? false,
    },
    ipAddress: null,
  });

  return booking;
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
