import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName } from '../integrations.repository';
import { findCredentialsById } from '../integrations.repository';
import { loggedFetch, type ConnectorResult } from '../connector.base';

/**
 * Facebook Business / Lead Ads connector.
 *
 * Auth: OAuth 2.0 — user or system-user access token + optional refresh.
 * Credentials shape:
 *   {
 *     appId: string,
 *     appSecret: string,
 *     accessToken: string,
 *     refreshToken?: string,
 *     accessTokenExpiresAt?: string,
 *     pageId?: string,
 *     formId?: string,
 *   }
 *
 * Vendor docs (verified 2026-06):
 *   Exchange code: GET https://graph.facebook.com/v20.0/oauth/access_token
 *                  ?client_id=APP_ID&client_secret=APP_SECRET&code=AUTH_CODE
 *   Long-lived:    GET https://graph.facebook.com/v20.0/oauth/access_token
 *                  ?grant_type=fb_exchange_token&client_id=...&client_secret=...&fb_exchange_token=...
 *   Lead retrieval: GET https://graph.facebook.com/v20.0/{form_id}/leads
 *                  ?access_token=...
 *   HMAC verify : X-Hub-Signature-256: sha256=<hex> = HMAC-SHA256(rawBody, appSecret)
 */

export const FACEBOOK_PROVIDER_NAME = 'facebook';

export const facebookCredentialsSchema = z
  .object({
    appId: z.string().min(1, 'appId is required'),
    appSecret: z.string().min(1, 'appSecret is required'),
    accessToken: z.string().min(1, 'accessToken is required'),
    accessTokenExpiresAt: z.string().datetime().optional(),
    pageId: z.string().optional(),
    formId: z.string().optional(),
  })
  .strict();

export type FacebookCredentials = z.infer<typeof facebookCredentialsSchema>;

const REFRESH_SKEW_MS = 60_000 * 60 * 24; // 1 day

function isExpiringSoon(creds: FacebookCredentials): boolean {
  if (!creds.accessTokenExpiresAt) return false; // long-lived, treat as fresh
  const ts = Date.parse(creds.accessTokenExpiresAt);
  return Number.isNaN(ts) || ts - Date.now() < REFRESH_SKEW_MS;
}

/**
 * Exchanges the current short-lived token for a long-lived one (60d).
 * Idempotent — Facebook returns the same long-lived token if called twice.
 */
export async function exchangeForLongLivedToken(
  creds: FacebookCredentials,
): Promise<{ accessToken: string; expiresAt: string | null }> {
  const url =
    `https://graph.facebook.com/v20.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(creds.appId)}` +
    `&client_secret=${encodeURIComponent(creds.appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(creds.accessToken)}`;
  const res = await loggedFetch<{ access_token: string; expires_in: number }>(
    url,
    { method: 'GET' },
    {
      channel: 'facebook',
      context: { op: 'oauth_long_lived' },
    },
  );
  if (!res.ok) throw new AppError(`Facebook long-lived token exchange failed: ${res.error}`, 502);
  const token = res.data?.access_token;
  if (!token) throw new AppError('Facebook token response missing access_token', 502);
  const ttl = res.data?.expires_in ?? 60 * 24 * 60 * 60;
  return {
    accessToken: token,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

export async function loadCredentials(): Promise<FacebookCredentials> {
  const row = await findByName(FACEBOOK_PROVIDER_NAME);
  if (!row) throw new AppError('Facebook integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Facebook credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Facebook credential decryption failed: ${message}`, 422);
  }
  const result = facebookCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Facebook credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

/** Public projection used by `findLeadById`-style helpers — never log this raw. */
export interface FacebookLead {
  id: string;
  created_time: string;
  field_data: Array<{ name: string; values: string[] }>;
}

/**
 * Pulls leads from a single Facebook Lead Form. Idempotent — caller passes
 * `since` timestamp to filter server-side. Token refresh is handled inline.
 */
export async function fetchFormLeads(
  integrationId: string,
  formId: string,
  since: Date,
): Promise<ConnectorResult<{ data: FacebookLead[] }>> {
  const creds = await loadCredentials();
  let accessToken = creds.accessToken;
  if (isExpiringSoon(creds)) {
    const refreshed = await exchangeForLongLivedToken(creds);
    accessToken = refreshed.accessToken;
    await persistAccessToken(integrationId, refreshed.accessToken, refreshed.expiresAt);
  }

  const sinceUnix = Math.floor(since.getTime() / 1000);
  const url =
    `https://graph.facebook.com/v20.0/${encodeURIComponent(formId)}/leads` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":${sinceUnix}}]` +
    `&fields=id,created_time,field_data`;

  return loggedFetch<{ data: FacebookLead[] }>(
    url,
    { method: 'GET' },
    {
      channel: 'facebook',
      context: { formId, op: 'fetch_leads' },
    },
  );
}

async function persistAccessToken(
  integrationId: string,
  accessToken: string,
  expiresAt: string | null,
): Promise<void> {
  const { findCredentialsById } = await import('../integrations.repository');
  const { updateIntegration: repoUpdate } = await import('../integrations.repository');
  const { encryptJson, decryptJson } = await import('../../../shared/utils/encryption');
  const row = await findCredentialsById(integrationId);
  if (!row) return;
  let current: Record<string, unknown> = {};
  try {
    current = decryptJson<Record<string, unknown>>(row);
  } catch {
    /* ignore */
  }
  const merged: Record<string, unknown> = { ...current, accessToken };
  if (expiresAt) merged.accessTokenExpiresAt = expiresAt;
  await repoUpdate(integrationId, {
    isEnabled: undefined,
    encryptedCredentials: encryptJson(merged),
    updatedBy: '00000000-0000-0000-0000-000000000001',
  });
}
