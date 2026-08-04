import { pool, query, queryOne, withTransaction } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { Availability, BookingUrl, Booking, UserDateOverride } from './scheduling.types';

// ── Availability ─────────────────────────────────────────────────────────

const AVAIL_COLS = `id, user_id, day_of_week, start_time, end_time, slot_duration_min, is_active, created_at, updated_at`;

export async function findAvailabilityByUser(userId: string): Promise<Availability[]> {
  return query<Availability>(
    `SELECT ${AVAIL_COLS} FROM user_availability WHERE user_id = $1 ORDER BY day_of_week, start_time`,
    [userId],
  );
}

export async function findAvailabilityByUserAndDay(
  userId: string,
  dayOfWeek: number,
): Promise<Availability[]> {
  return query<Availability>(
    `SELECT ${AVAIL_COLS} FROM user_availability WHERE user_id = $1 AND day_of_week = $2 AND is_active = true ORDER BY start_time`,
    [userId, dayOfWeek],
  );
}

export async function upsertAvailability(
  userId: string,
  slots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotDurationMin: number;
    isActive: boolean;
  }>,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM user_availability WHERE user_id = $1', [userId]);

    for (const slot of slots) {
      await client.query(
        `INSERT INTO user_availability (user_id, day_of_week, start_time, end_time, slot_duration_min, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, slot.dayOfWeek, slot.startTime, slot.endTime, slot.slotDurationMin, slot.isActive],
      );
    }
  });
}

// ── Booking URLs ─────────────────────────────────────────────────────────

const BOOKING_URL_COLS = `id, user_id, slug, title, description, location_type, location_details, buffer_before_min, buffer_after_min, max_advance_days, is_active, created_at, updated_at`;

export async function findBookingUrlsByUser(userId: string): Promise<BookingUrl[]> {
  return query<BookingUrl>(
    `SELECT ${BOOKING_URL_COLS} FROM booking_urls WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
}

export async function findBookingUrlBySlug(slug: string): Promise<BookingUrl | null> {
  return queryOne<BookingUrl>(
    `SELECT ${BOOKING_URL_COLS} FROM booking_urls WHERE slug = $1 AND is_active = true`,
    [slug],
  );
}

export async function findBookingUrlById(id: string): Promise<BookingUrl | null> {
  return queryOne<BookingUrl>(`SELECT ${BOOKING_URL_COLS} FROM booking_urls WHERE id = $1`, [id]);
}

export async function insertBookingUrl(data: {
  user_id: string;
  slug: string;
  title: string;
  description?: string;
  location_type: string;
  location_details?: string;
  buffer_before_min: number;
  buffer_after_min: number;
  max_advance_days: number;
}): Promise<BookingUrl> {
  const row = await queryOne<BookingUrl>(
    `INSERT INTO booking_urls (user_id, slug, title, description, location_type, location_details, buffer_before_min, buffer_after_min, max_advance_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${BOOKING_URL_COLS}`,
    [
      data.user_id,
      data.slug,
      data.title,
      data.description ?? null,
      data.location_type,
      data.location_details ?? null,
      data.buffer_before_min,
      data.buffer_after_min,
      data.max_advance_days,
    ],
  );
  if (!row) throw new AppError('Failed to create booking URL', 500);
  return row;
}

export async function updateBookingUrl(
  id: string,
  fields: Partial<{
    title: string;
    description: string;
    location_type: string;
    location_details: string;
    buffer_before_min: number;
    buffer_after_min: number;
    max_advance_days: number;
    is_active: boolean;
  }>,
): Promise<BookingUrl> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(fields.title);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(fields.description);
  }
  if (fields.location_type !== undefined) {
    sets.push(`location_type = $${i++}`);
    params.push(fields.location_type);
  }
  if (fields.location_details !== undefined) {
    sets.push(`location_details = $${i++}`);
    params.push(fields.location_details);
  }
  if (fields.buffer_before_min !== undefined) {
    sets.push(`buffer_before_min = $${i++}`);
    params.push(fields.buffer_before_min);
  }
  if (fields.buffer_after_min !== undefined) {
    sets.push(`buffer_after_min = $${i++}`);
    params.push(fields.buffer_after_min);
  }
  if (fields.max_advance_days !== undefined) {
    sets.push(`max_advance_days = $${i++}`);
    params.push(fields.max_advance_days);
  }
  if (fields.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(fields.is_active);
  }

  if (sets.length === 0) {
    const existing = await findBookingUrlById(id);
    if (!existing) throw new AppError('Booking URL not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE booking_urls SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING ${BOOKING_URL_COLS}`;
  const row = await queryOne<BookingUrl>(sql, params);
  if (!row) throw new AppError('Booking URL not found', 404);
  return row;
}

// ── Bookings ─────────────────────────────────────────────────────────────

const BOOKING_COLS = `id, booking_url_id, user_id, lead_id, booker_name, booker_email, booker_phone, starts_at, ends_at, status, meeting_url, notes, google_event_id, created_at, updated_at`;

export async function findBookingById(id: string): Promise<Booking | null> {
  return queryOne<Booking>(`SELECT ${BOOKING_COLS} FROM bookings WHERE id = $1`, [id]);
}

export async function findBookingsByUser(userId: string, limit = 50): Promise<Booking[]> {
  return query<Booking>(
    `SELECT ${BOOKING_COLS} FROM bookings WHERE user_id = $1 AND status != 'cancelled' ORDER BY starts_at DESC LIMIT $2`,
    [userId, limit],
  );
}

export async function findBookingsByUserAndDateRange(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<Booking[]> {
  return query<Booking>(
    `SELECT ${BOOKING_COLS} FROM bookings
     WHERE user_id = $1 AND status != 'cancelled'
       AND starts_at >= $2 AND starts_at < $3
     ORDER BY starts_at`,
    [userId, startDate, endDate],
  );
}

export async function insertBooking(data: {
  booking_url_id: string;
  user_id: string;
  lead_id: string | null;
  booker_name: string;
  booker_email: string;
  booker_phone: string | null;
  starts_at: string;
  ends_at: string;
  meeting_url: string | null;
  notes: string | null;
  google_event_id: string | null;
}): Promise<Booking> {
  const row = await queryOne<Booking>(
    `INSERT INTO bookings (booking_url_id, user_id, lead_id, booker_name, booker_email, booker_phone, starts_at, ends_at, meeting_url, notes, google_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${BOOKING_COLS}`,
    [
      data.booking_url_id,
      data.user_id,
      data.lead_id,
      data.booker_name,
      data.booker_email,
      data.booker_phone,
      data.starts_at,
      data.ends_at,
      data.meeting_url,
      data.notes,
      data.google_event_id,
    ],
  );
  if (!row) throw new AppError('Failed to create booking', 500);
  return row;
}

export async function updateBookingStatus(id: string, status: string): Promise<Booking> {
  const row = await queryOne<Booking>(
    `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING ${BOOKING_COLS}`,
    [status, id],
  );
  if (!row) throw new AppError('Booking not found', 404);
  return row;
}

export async function findConflictingBookings(
  userId: string,
  startsAt: string,
  endsAt: string,
): Promise<Booking[]> {
  return query<Booking>(
    `SELECT ${BOOKING_COLS} FROM bookings
     WHERE user_id = $1 AND status != 'cancelled'
       AND starts_at < $3 AND ends_at > $2`,
    [userId, startsAt, endsAt],
  );
}

// ── Round Robin ──────────────────────────────────────────────────────────

export async function getAllBookingUrlUsers(): Promise<{ user_id: string; slug: string }[]> {
  return query<{ user_id: string; slug: string }>(
    `SELECT DISTINCT user_id, slug FROM booking_urls WHERE is_active = true`,
  );
}

export async function getLastBookedUser(userIds: string[]): Promise<string | null> {
  if (userIds.length === 0) return null;
  const row = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM bookings WHERE status != 'cancelled' AND user_id = ANY($1) ORDER BY created_at DESC LIMIT 1`,
    [userIds],
  );
  return row?.user_id ?? null;
}

// ── Date Overrides ───────────────────────────────────────────────────────

const OVERRIDE_COLS =
  'id, user_id, override_date, is_blocked, start_time, end_time, reason, created_at, updated_at';

export async function findDateOverridesByUser(userId: string): Promise<UserDateOverride[]> {
  return query<UserDateOverride>(
    `SELECT ${OVERRIDE_COLS} FROM user_date_overrides WHERE user_id = $1 ORDER BY override_date DESC`,
    [userId],
  );
}

export async function findDateOverrideByUserAndDate(
  userId: string,
  date: string,
): Promise<UserDateOverride | null> {
  return queryOne<UserDateOverride>(
    `SELECT ${OVERRIDE_COLS} FROM user_date_overrides WHERE user_id = $1 AND override_date = $2`,
    [userId, date],
  );
}

export async function upsertDateOverride(
  userId: string,
  data: {
    overrideDate: string;
    isBlocked: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  },
): Promise<UserDateOverride> {
  const row = await queryOne<UserDateOverride>(
    `INSERT INTO user_date_overrides (user_id, override_date, is_blocked, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, override_date) DO UPDATE SET
       is_blocked = EXCLUDED.is_blocked,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       reason = EXCLUDED.reason,
       updated_at = NOW()
     RETURNING ${OVERRIDE_COLS}`,
    [
      userId,
      data.overrideDate,
      data.isBlocked,
      data.startTime ?? null,
      data.endTime ?? null,
      data.reason ?? null,
    ],
  );
  if (!row) throw new AppError('Failed to save date override', 500);
  return row;
}

export async function deleteDateOverride(id: string, userId: string): Promise<void> {
  await pool.query('DELETE FROM user_date_overrides WHERE id = $1 AND user_id = $2', [id, userId]);
}
