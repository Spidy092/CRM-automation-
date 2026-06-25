import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName } from '../integrations.repository';
import { findCredentialsById } from '../integrations.repository';
import { loggedFetch, type ConnectorResult } from '../connector.base';

/**
 * Google Ads (Lead Form Extension) connector.
 *
 * Auth: OAuth 2.0 — access token + refresh token issued by `oauth/google-ads`.
 * Credentials shape (stored encrypted at rest in `integrations.encrypted_credentials`):
 *   {
 *     developerToken: string,
 *     clientId: string,
 *     clientSecret: string,
 *     refreshToken: string,
 *     accessToken?: string,
 *     accessTokenExpiresAt?: string,  // ISO-8601 UTC
 *     loginCustomerId?: string,        // MCC account id (optional)
 *   }
 *
 * Vendor docs (verified 2026-06):
 *   Token refresh: POST https://oauth2.googleapis.com/token
 *                  body: client_id, client_secret, refresh_token, grant_type=refresh_token
 *   Lead form ext.: GoogleAdsService.SearchStream via Google Ads API (gRPC),
 *                  but we expose a simpler REST helper that returns the
 *                  current credentials after a refresh. Outbound lead-form
 *                  ingest is via webhooks (`POST /webhooks/google-ads`).
 */

export const GOOGLE_ADS_PROVIDER_NAME = 'google_ads';

export const googleAdsCredentialsSchema = z
  .object({
    developerToken: z.string().min(1, 'developerToken is required'),
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    refreshToken: z.string().min(1, 'refreshToken is required'),
    accessToken: z.string().optional(),
    accessTokenExpiresAt: z.string().datetime().optional(),
    loginCustomerId: z.string().optional(),
  })
  .strict();

export type GoogleAdsCredentials = z.infer<typeof googleAdsCredentialsSchema>;

/** Skew-aware check: refresh when within 60s of expiry. */
const REFRESH_SKEW_MS = 60_000;

function isExpiringSoon(creds: GoogleAdsCredentials): boolean {
  if (!creds.accessToken || !creds.accessTokenExpiresAt) return true;
  const expiresAt = Date.parse(creds.accessTokenExpiresAt);
  return Number.isNaN(expiresAt) || expiresAt - Date.now() < REFRESH_SKEW_MS;
}

/**
 * Returns a fresh access token, refreshing via Google's token endpoint when
 * needed. Caller passes the stored `integrationId` so we can persist the
 * refreshed token back to the integrations table.
 */
export async function getAccessToken(integrationId: string): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const creds = await loadCredentials();
  if (!isExpiringSoon(creds)) {
    return { accessToken: creds.accessToken!, expiresAt: creds.accessTokenExpiresAt! };
  }
  const refreshed = await refreshAccessToken(creds);
  await persistRefreshedToken(integrationId, refreshed.accessToken, refreshed.expiresAt);
  return refreshed;
}

async function refreshAccessToken(
  creds: GoogleAdsCredentials,
): Promise<{ accessToken: string; expiresAt: string }> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  }).toString();

  const res = await loggedFetch<{ access_token: string; expires_in: number }>(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { channel: 'google_ads', context: { op: 'oauth_refresh' } },
  );

  if (!res.ok) {
    throw new AppError(`Google Ads token refresh failed: ${res.error}`, 502);
  }
  const token = res.data?.access_token;
  const ttl = res.data?.expires_in ?? 3600;
  if (!token) {
    throw new AppError('Google Ads token refresh response missing access_token', 502);
  }
  return {
    accessToken: token,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

async function persistRefreshedToken(
  integrationId: string,
  accessToken: string,
  expiresAt: string,
): Promise<void> {
  // Re-read the current creds and merge new fields — preserves other keys.
  const row = await findCredentialsById(integrationId);
  if (!row) return;
  let current: Record<string, unknown> = {};
  try {
    current = decryptJson<Record<string, unknown>>(row);
  } catch {
    /* ignore — fresh creds from refresh take precedence */
  }
  const merged: Record<string, unknown> = {
    ...current,
    accessToken,
    accessTokenExpiresAt: expiresAt,
  };
  const { encryptJson } = await import('../../../shared/utils/encryption');
  const enc = encryptJson(merged);
  // We bypass the public updateIntegration() because we never want to leak
  // the new access token in audit logs / responses.
  const { updateIntegration: repoUpdate } = await import('../integrations.repository');
  await repoUpdate(integrationId, {
    isEnabled: undefined,
    encryptedCredentials: enc,
    updatedBy: '00000000-0000-0000-0000-000000000001',
  });
}

export async function loadCredentials(): Promise<GoogleAdsCredentials> {
  const row = await findByName(GOOGLE_ADS_PROVIDER_NAME);
  if (!row) throw new AppError('Google Ads integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Google Ads credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Google Ads credential decryption failed: ${message}`, 422);
  }
  const result = googleAdsCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Google Ads credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

/**
 * Generic REST helper to call Google Ads REST endpoints. (Most of the
 * Google Ads API is gRPC; this helper exists for the small set of REST
 * surfaces — e.g. conversion uploads, which we don't expose yet but want
 * the seam ready.)
 */
export async function callRest<T = unknown>(
  integrationId: string,
  path: string,
  init: RequestInit,
): Promise<ConnectorResult<T>> {
  const { accessToken } = await getAccessToken(integrationId);
  const url = `https://googleads.googleapis.com/v17${path}`;
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'developer-token': (await loadCredentials()).developerToken,
    'content-type': 'application/json',
  };
  const loginCid = (await loadCredentials()).loginCustomerId;
  if (loginCid) headers['login-customer-id'] = loginCid;

  return loggedFetch<T>(
    url,
    { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } },
    {
      channel: 'google_ads',
      context: { path },
    },
  );
}
