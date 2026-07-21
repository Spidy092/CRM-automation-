import { logger } from '../../shared/utils/logger';
import { Campaign } from './campaigns.types';

/**
 * Send-window evaluation for campaign outreach.
 *
 * A window is defined in the campaign's own timezone as:
 *   - allowed ISO weekdays (1 = Monday … 7 = Sunday)
 *   - a daily hour range [startHour, endHour) — start inclusive, end exclusive
 *
 * The worker calls computeSendWindowDelayMs() before dispatching; a non-zero
 * result means "defer this send by that many milliseconds".
 */

export interface SendWindowConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
  /** IANA timezone name, e.g. 'Asia/Kolkata'. */
  timezone: string;
}

const WEEKDAY_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Max look-ahead when searching for the next open slot (hour steps). */
const MAX_LOOKAHEAD_HOURS = 8 * 24;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Local weekday (ISO 1–7) and hour (0–23) of an instant in a timezone. */
function zonedParts(date: Date, timezone: string): { isoDay: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  return { isoDay: WEEKDAY_TO_ISO[weekday] ?? 1, hour };
}

function isInsideWindow(config: SendWindowConfig, at: Date): boolean {
  const { isoDay, hour } = zonedParts(at, config.timezone);
  return config.days.includes(isoDay) && hour >= config.startHour && hour < config.endHour;
}

/**
 * Returns true when the config cannot possibly open (and must therefore be
 * ignored rather than deferring a send forever).
 */
function isUnsatisfiable(config: SendWindowConfig): boolean {
  const validDays = config.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return (
    validDays.length === 0 ||
    config.startHour < 0 ||
    config.startHour > 23 ||
    config.endHour < 1 ||
    config.endHour > 24 ||
    config.startHour >= config.endHour
  );
}

/**
 * Milliseconds to wait from `now` until the window is open.
 * Returns 0 when the window is disabled, currently open, or misconfigured
 * (a broken window must never block sends indefinitely — it is logged and
 * treated as open).
 */
export function computeSendWindowDelayMs(config: SendWindowConfig, now: Date = new Date()): number {
  if (!config.enabled) return 0;

  if (isUnsatisfiable(config) || !isValidTimezone(config.timezone)) {
    logger.warn('send window config unsatisfiable or invalid — treating as open', {
      startHour: config.startHour,
      endHour: config.endHour,
      days: config.days,
      timezone: config.timezone,
    });
    return 0;
  }

  if (isInsideWindow(config, now)) return 0;

  // Walk forward hour-boundary by hour-boundary until the window opens.
  // The first in-window boundary is the top of the opening hour, which is
  // exactly the window start (minute precision).
  const HOUR_MS = 60 * 60 * 1000;
  let candidate = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  for (let i = 0; i < MAX_LOOKAHEAD_HOURS; i += 1) {
    if (isInsideWindow(config, candidate)) {
      return Math.max(candidate.getTime() - now.getTime(), 0);
    }
    candidate = new Date(candidate.getTime() + HOUR_MS);
  }

  // Should be unreachable given the satisfiability check above.
  logger.warn('send window: no opening found within look-ahead — treating as open', {
    timezone: config.timezone,
  });
  return 0;
}

export function sendWindowFromCampaign(campaign: Campaign): SendWindowConfig {
  return {
    enabled: campaign.send_window_enabled,
    startHour: campaign.send_window_start_hour,
    endHour: campaign.send_window_end_hour,
    days: campaign.send_window_days ?? [],
    timezone: campaign.send_window_timezone || 'UTC',
  };
}

/**
 * Milliseconds until the next local midnight in `timezone` — used to defer a
 * send that hit the campaign's daily cap to the following day.
 */
export function computeDelayToNextLocalMidnightMs(
  timezone: string,
  now: Date = new Date(),
): number {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  const HOUR_MS = 60 * 60 * 1000;
  const startDay = zonedParts(now, tz).isoDay;
  let candidate = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  for (let i = 0; i < 49; i += 1) {
    if (zonedParts(candidate, tz).isoDay !== startDay) {
      return Math.max(candidate.getTime() - now.getTime(), 0);
    }
    candidate = new Date(candidate.getTime() + HOUR_MS);
  }
  return 24 * HOUR_MS;
}

/**
 * Combined deferral for a dispatch: send window plus daily cap.
 *
 * @param campaign        the campaign row
 * @param sentTodayCount  messages already sent today (campaign-local day), or
 *                        null when the campaign has no daily limit
 * @param now             evaluation instant (injectable for tests)
 */
export function computeDispatchDeferralMs(
  campaign: Campaign,
  sentTodayCount: number | null,
  now: Date = new Date(),
): { delayMs: number; reason: 'send_window' | 'daily_cap' | null } {
  const windowDelay = computeSendWindowDelayMs(sendWindowFromCampaign(campaign), now);

  const limit = campaign.daily_send_limit;
  if (limit != null && sentTodayCount != null && sentTodayCount >= limit) {
    const toMidnight = computeDelayToNextLocalMidnightMs(campaign.send_window_timezone, now);
    const afterMidnight = new Date(now.getTime() + toMidnight);
    const windowAfterMidnight = computeSendWindowDelayMs(
      sendWindowFromCampaign(campaign),
      afterMidnight,
    );
    const capDelay = toMidnight + windowAfterMidnight;
    return capDelay >= windowDelay
      ? { delayMs: capDelay, reason: 'daily_cap' }
      : { delayMs: windowDelay, reason: 'send_window' };
  }

  if (windowDelay > 0) return { delayMs: windowDelay, reason: 'send_window' };
  return { delayMs: 0, reason: null };
}
