/**
 * Google Calendar connector.
 *
 * Used to schedule follow-up meetings / call reminders on a rep's calendar
 * when a phone_call outreach step fires.
 *
 * Auth: OAuth 2.0 — access_token + refresh_token stored post-authorization.
 *
 * Credentials shape:
 *   { clientId, clientSecret, accessToken, refreshToken, calendarId? }
 *
 * Vendor docs (verified 2026-06):
 *   Calendar REST API : https://developers.google.com/calendar/api/v3/reference
 *   OAuth token refresh: POST https://oauth2.googleapis.com/token
 *   Create event       : POST /calendar/v3/calendars/{calendarId}/events
 */

import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { loggedFetch } from '../connector.base';
import { logger } from '../../../shared/utils/logger';

export const GOOGLE_CALENDAR_PROVIDER_NAME = 'google_calendar';

export const googleCalendarCredentialsSchema = z
  .object({
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    accessToken: z.string().min(1, 'accessToken is required'),
    refreshToken: z.string().min(1, 'refreshToken is required'),
    /** Target calendar — defaults to 'primary' if omitted. */
    calendarId: z.string().min(1).optional(),
  })
  .strict();

export type GoogleCalendarCredentials = z.infer<typeof googleCalendarCredentialsSchema>;

// ── Result types ────────────────────────────────────────────────────────────

export type CalendarResult =
  | { ok: true; eventId: string; htmlLink: string; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

// ── Credential loader ────────────────────────────────────────────────────────

export async function loadCredentials(): Promise<GoogleCalendarCredentials> {
  const row = await findByName(GOOGLE_CALENDAR_PROVIDER_NAME);
  if (!row) throw new AppError('Google Calendar integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Google Calendar credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Google Calendar credential decryption failed: ${message}`, 422);
  }

  const result = googleCalendarCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Google Calendar credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

// ── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(creds: GoogleCalendarCredentials): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new AppError(`Google Calendar token refresh failed: HTTP ${res.status}`, 502);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError('Google Calendar token refresh returned no access_token', 502);
  }
  return body.access_token;
}

// ── Create event ─────────────────────────────────────────────────────────────

export interface CreateEventInput {
  summary: string;
  description?: string;
  /** ISO 8601 UTC start time, e.g. "2026-06-25T09:00:00Z" */
  startAt: string;
  /** ISO 8601 UTC end time. Defaults to startAt + 30 min if omitted. */
  endAt?: string;
  /** Attendee email addresses. */
  attendees?: string[];
  /** Override calendarId from credentials. */
  calendarId?: string;
}

/**
 * Creates a calendar event.
 * Attempts a token refresh once on 401 before giving up.
 */
export async function createEvent(
  input: CreateEventInput,
  leadId?: string | null,
  campaignId?: string | null,
): Promise<CalendarResult> {
  const start = Date.now();

  let creds: GoogleCalendarCredentials;
  try {
    creds = await loadCredentials();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn('Google Calendar loadCredentials failed', {
      channel: 'google_ads',
      lead_id: leadId ?? null,
      campaign_id: campaignId ?? null,
      error: message,
      provider: 'google_calendar',
    });
    return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
  }

  const calendarId = encodeURIComponent(input.calendarId ?? creds.calendarId ?? 'primary');
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;

  // Default end = start + 30 minutes
  const endAt =
    input.endAt ?? new Date(new Date(input.startAt).getTime() + 30 * 60 * 1000).toISOString();

  const eventBody = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startAt, timeZone: 'UTC' },
    end: { dateTime: endAt, timeZone: 'UTC' },
    attendees: (input.attendees ?? []).map((email) => ({ email })),
  };

  const body = JSON.stringify(eventBody);
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  let res = await loggedFetch(
    url,
    { method: 'POST', headers: headers(creds.accessToken), body },
    {
      channel: 'google_ads',
      leadId,
      campaignId,
      context: { provider: 'google_calendar', calendarId },
    },
  );

  // Retry once on 401 with refreshed token
  if (!res.ok && res.status === 401) {
    try {
      const freshToken = await refreshAccessToken(creds);
      res = await loggedFetch(
        url,
        { method: 'POST', headers: headers(freshToken), body },
        {
          channel: 'google_ads',
          leadId,
          campaignId,
          context: { provider: 'google_calendar', calendarId, tokenRefreshed: true },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'token refresh failed';
      return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
    }
  }

  if (!res.ok) {
    return {
      ok: false,
      error: res.error ?? `HTTP ${res.status}`,
      retryable: res.retryable ?? false,
      latencyMs: Date.now() - start,
    };
  }

  const data = res.data as { id?: string; htmlLink?: string };
  return {
    ok: true,
    eventId: data?.id ?? '',
    htmlLink: data?.htmlLink ?? '',
    latencyMs: Date.now() - start,
  };
}

export async function testConnection(
  creds: GoogleCalendarCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    // A successful token refresh confirms the OAuth credentials are valid and active
    await refreshAccessToken(creds);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown Google Calendar error',
      latencyMs: Date.now() - start,
    };
  }
}
