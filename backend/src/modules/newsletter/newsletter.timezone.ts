import { AppError } from '../../shared/middleware/errorHandler';

/**
 * Timezone-aware scheduling for newsletter broadcasts.
 *
 * The composer submits a wall-clock time (`datetime-local`, no offset) plus
 * an IANA timezone name. This module converts that pair into the correct
 * UTC instant using only the Node 20 ICU build (no new dependencies).
 *
 * Semantics (documented for the UI and API consumers):
 * - The timezone AFFECTS the instant: "09:00 in Asia/Kolkata" and "09:00 in
 *   UTC" schedule different moments. The canonical UTC ISO string is what
 *   the queue delay and the worker consume; the original wall time + zone
 *   are retained for display.
 * - Nonexistent local times (DST spring-forward gap, e.g. 2026-03-08 02:30
 *   in America/New_York) are REJECTED with 422 — silently shifting them
 *   would send at a time the user never chose.
 * - Ambiguous local times (DST fall-back fold, e.g. 2026-11-01 01:30 in
 *   America/New_York, which occurs twice) resolve to the EARLIER occurrence
 *   (still on daylight time). The response echoes the resolved UTC instant
 *   so the review step can display it.
 * - Unknown zone names are rejected with 422 (Intl throws RangeError).
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const wallFmtCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = wallFmtCache.get(timeZone);
  if (!fmt) {
    // Throws RangeError for unknown zones — converted to 422 by the caller.
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallFmtCache.set(timeZone, fmt);
  }
  return fmt;
}

function wallParts(instantMs: number, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of wallFormatter(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal' && part.type !== 'timeZoneName') {
      out[part.type] = parseInt(part.value, 10);
    }
  }
  // en-US hour12:false can emit hour "24" at midnight; normalize.
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset in minutes such that utcMs + offset = wall clock in `timeZone`. */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const parts = wallParts(utcMs, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  return Math.round((asUtc - utcMs) / 60000);
}

export interface ResolvedSchedule {
  /** Canonical UTC instant consumed by the queue delay and worker. */
  utcIso: string;
  /** Echo of the submitted wall time (display). */
  local: string;
  /** Echo of the submitted zone (display). */
  timeZone: string;
  /** True when the wall time was ambiguous (fold); earlier occurrence used. */
  ambiguous: boolean;
}

export function localDateTimeInZoneToUtc(local: string, timeZone: string): ResolvedSchedule {
  const match = LOCAL_RE.exec(local);
  if (!match) {
    throw new AppError('scheduledAtLocal must be YYYY-MM-DDTHH:mm (e.g. 2026-05-01T09:00)', 422);
  }
  const [, y, mo, d, h, mi, s] = match;
  const parts = {
    year: parseInt(y, 10),
    month: parseInt(mo, 10),
    day: parseInt(d, 10),
    hour: parseInt(h, 10),
    minute: parseInt(mi, 10),
    second: s !== undefined ? parseInt(s, 10) : 0,
  };
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    throw new AppError('scheduledAtLocal is not a valid calendar date/time', 422);
  }

  let zone: string;
  try {
    wallFormatter(timeZone);
    zone = timeZone;
  } catch {
    throw new AppError(`Unknown timezone: ${timeZone}`, 422);
  }

  // Enumerate offsets on both sides of a possible transition rather than
  // converging on one offset, which can hide the earlier fold occurrence.
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const dayMs = 24 * 60 * 60000;
  const offsets = new Set([
    offsetMinutesAt(wallAsUtc - dayMs, zone),
    offsetMinutesAt(wallAsUtc + dayMs, zone),
  ]);
  const candidates = [...offsets]
    .map((offset) => wallAsUtc - offset * 60000)
    .filter((instant): boolean => {
      const back = wallParts(instant, zone);
      return (
        back.year === parts.year &&
        back.month === parts.month &&
        back.day === parts.day &&
        back.hour === parts.hour &&
        back.minute === parts.minute &&
        back.second === parts.second
      );
    })
    .sort((a, b) => a - b);
  if (candidates.length === 0) {
    throw new AppError(
      `Local time ${local} does not exist in ${zone} (daylight-saving transition gap). Choose a different time.`,
      422,
    );
  }

  const utcMs = candidates[0];
  const ambiguous = candidates.length > 1;

  return { utcIso: new Date(utcMs).toISOString(), local, timeZone: zone, ambiguous };
}
