/**
 * Google Sheets connector.
 *
 * Used to export lead lists and campaign reports to a Google Spreadsheet.
 * Auth: OAuth 2.0 — access_token + refresh_token pair stored post-authorization.
 *
 * Credentials shape:
 *   { clientId, clientSecret, accessToken, refreshToken, spreadsheetId? }
 *
 * Vendor docs (verified 2026-06):
 *   Sheets REST API  : https://developers.google.com/sheets/api/reference/rest
 *   OAuth token refresh: POST https://oauth2.googleapis.com/token
 *   Append values    : POST /v4/spreadsheets/{id}/values/{range}:append
 */

import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { loggedFetch } from '../connector.base';
import { logger } from '../../../shared/utils/logger';

export const GOOGLE_SHEETS_PROVIDER_NAME = 'google_sheets';

export const googleSheetsCredentialsSchema = z
  .object({
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    accessToken: z.string().min(1, 'accessToken is required'),
    refreshToken: z.string().min(1, 'refreshToken is required'),
    /** Optional: default spreadsheet to write to */
    spreadsheetId: z.string().min(1).optional(),
  })
  .strict();

export type GoogleSheetsCredentials = z.infer<typeof googleSheetsCredentialsSchema>;

// ── Result types ────────────────────────────────────────────────────────────

export type SheetsResult =
  | { ok: true; updatedRange: string; updatedRows: number; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

// ── Credential loader ────────────────────────────────────────────────────────

export async function loadCredentials(): Promise<GoogleSheetsCredentials> {
  const row = await findByName(GOOGLE_SHEETS_PROVIDER_NAME);
  if (!row) throw new AppError('Google Sheets integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Google Sheets credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Google Sheets credential decryption failed: ${message}`, 422);
  }

  const result = googleSheetsCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Google Sheets credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

// ── Token refresh ────────────────────────────────────────────────────────────

/** Exchanges a refresh token for a fresh access token. */
async function refreshAccessToken(creds: GoogleSheetsCredentials): Promise<string> {
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
    throw new AppError(`Google Sheets token refresh failed: HTTP ${res.status}`, 502);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError('Google Sheets token refresh returned no access_token', 502);
  }
  return body.access_token;
}

// ── Append rows ──────────────────────────────────────────────────────────────

export interface AppendRowsInput {
  /** Spreadsheet ID. Falls back to the one stored in credentials if omitted. */
  spreadsheetId?: string;
  /** A1 notation range, e.g. "Sheet1!A1". */
  range?: string;
  /** Rows of cell values to append. */
  values: (string | number | boolean | null)[][];
}

/**
 * Appends one or more rows to a Google Sheet.
 * Attempts a token refresh once on 401 before giving up.
 */
export async function appendRows(
  input: AppendRowsInput,
  leadId?: string | null,
  campaignId?: string | null,
): Promise<SheetsResult> {
  const start = Date.now();

  let creds: GoogleSheetsCredentials;
  try {
    creds = await loadCredentials();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn('Google Sheets loadCredentials failed', {
      channel: 'google_sheets',
      lead_id: leadId ?? null,
      campaign_id: campaignId ?? null,
      error: message,
    });
    return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
  }

  const spreadsheetId = input.spreadsheetId ?? creds.spreadsheetId;
  if (!spreadsheetId) {
    return {
      ok: false,
      error: 'No spreadsheetId provided and none set in credentials',
      retryable: false,
      latencyMs: Date.now() - start,
    };
  }
  const range = encodeURIComponent(input.range ?? 'Sheet1!A1');
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append` +
    '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';

  const body = JSON.stringify({ values: input.values });
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  let res = await loggedFetch(
    url,
    { method: 'POST', headers: headers(creds.accessToken), body },
    {
      channel: 'google_ads', // connector.base only allows its typed channels; use closest
      leadId,
      campaignId,
      context: { provider: 'google_sheets', spreadsheetId },
    },
  );

  // Refresh token on 401 and retry once
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
          context: { provider: 'google_sheets', spreadsheetId, tokenRefreshed: true },
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

  const data = res.data as { updates?: { updatedRange?: string; updatedRows?: number } };
  return {
    ok: true,
    updatedRange: data?.updates?.updatedRange ?? '',
    updatedRows: data?.updates?.updatedRows ?? input.values.length,
    latencyMs: Date.now() - start,
  };
}

export async function testConnection(
  creds: GoogleSheetsCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    // A successful token refresh confirms the OAuth credentials are valid and active
    await refreshAccessToken(creds);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown Google Sheets error',
      latencyMs: Date.now() - start,
    };
  }
}
