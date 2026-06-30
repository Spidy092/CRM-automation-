/**
 * Microsoft Outlook / Microsoft 365 email connector.
 *
 * Used to send outreach emails via the Microsoft Graph API when SendGrid
 * and SMTP are both unavailable. Auth: OAuth 2.0 client-credentials flow
 * or delegated flow — access_token + refresh_token stored post-authorization.
 *
 * Credentials shape:
 *   { tenantId, clientId, clientSecret, accessToken, refreshToken, fromAddress }
 *
 * Vendor docs (verified 2026-06):
 *   Graph API send mail: POST https://graph.microsoft.com/v1.0/me/sendMail
 *   Token endpoint      : POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
 */

import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { loggedFetch } from '../connector.base';
import { logger } from '../../../shared/utils/logger';

export const OUTLOOK_PROVIDER_NAME = 'outlook';

export const outlookCredentialsSchema = z
  .object({
    tenantId: z.string().min(1, 'tenantId is required'),
    clientId: z.string().min(1, 'clientId is required'),
    clientSecret: z.string().min(1, 'clientSecret is required'),
    accessToken: z.string().min(1, 'accessToken is required'),
    refreshToken: z.string().min(1, 'refreshToken is required'),
    /** The mailbox address used as the sender (must match the authenticated user). */
    fromAddress: z.string().email('fromAddress must be a valid email'),
    fromName: z.string().max(120).optional(),
  })
  .strict();

export type OutlookCredentials = z.infer<typeof outlookCredentialsSchema>;

// ── Result types ────────────────────────────────────────────────────────────

export type OutlookResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

// ── Credential loader ────────────────────────────────────────────────────────

export async function loadCredentials(): Promise<OutlookCredentials> {
  const row = await findByName(OUTLOOK_PROVIDER_NAME);
  if (!row) throw new AppError('Outlook integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Outlook credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Outlook credential decryption failed: ${message}`, 422);
  }

  const result = outlookCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Outlook credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

// ── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(creds: OutlookCredentials): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Mail.Send offline_access',
    }),
  });
  if (!res.ok) {
    throw new AppError(`Outlook token refresh failed: HTTP ${res.status}`, 502);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new AppError('Outlook token refresh returned no access_token', 502);
  }
  return body.access_token;
}

// ── Send email ───────────────────────────────────────────────────────────────

export interface SendEmailInput {
  leadId: string;
  campaignId?: string | null;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

/**
 * Sends an email via Microsoft Graph API (POST /me/sendMail).
 * Attempts a token refresh once on 401 before giving up.
 * Returns `OutlookResult` — never throws.
 */
export async function sendEmail(input: SendEmailInput): Promise<OutlookResult> {
  const start = Date.now();

  let creds: OutlookCredentials;
  try {
    creds = await loadCredentials();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn('Outlook loadCredentials failed', {
      channel: 'sendgrid', // closest channel in connector.base enum; actual provider logged below
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      error: message,
      provider: 'outlook',
    });
    return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
  }

  const url = 'https://graph.microsoft.com/v1.0/me/sendMail';

  const payload = {
    message: {
      subject: input.subject,
      body: {
        contentType: 'HTML',
        content: input.htmlBody,
      },
      toRecipients: [{ emailAddress: { address: input.to } }],
      from: {
        emailAddress: {
          name: creds.fromName ?? creds.fromAddress,
          address: creds.fromAddress,
        },
      },
    },
    saveToSentItems: false,
  };

  const body = JSON.stringify(payload);
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  let res = await loggedFetch(
    url,
    { method: 'POST', headers: headers(creds.accessToken), body },
    {
      channel: 'sendgrid',
      leadId: input.leadId,
      campaignId: input.campaignId,
      context: { provider: 'outlook', to: input.to },
    },
  );

  // Retry once on 401 with a refreshed token
  if (!res.ok && res.status === 401) {
    try {
      const freshToken = await refreshAccessToken(creds);
      res = await loggedFetch(
        url,
        { method: 'POST', headers: headers(freshToken), body },
        {
          channel: 'sendgrid',
          leadId: input.leadId,
          campaignId: input.campaignId,
          context: { provider: 'outlook', to: input.to, tokenRefreshed: true },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'token refresh failed';
      return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
    }
  }

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    logger.warn('Outlook sendEmail failed', {
      channel: 'sendgrid',
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      status: res.status,
      latency_ms: latencyMs,
      provider: 'outlook',
    });
    return {
      ok: false,
      error: res.error ?? `HTTP ${res.status}`,
      retryable: res.retryable ?? false,
      latencyMs,
    };
  }

  // Graph API returns 202 Accepted with an empty body on success
  logger.info('Outlook email sent', {
    channel: 'sendgrid',
    lead_id: input.leadId,
    campaign_id: input.campaignId,
    status: 'sent',
    latency_ms: latencyMs,
    provider: 'outlook',
  });

  return { ok: true, latencyMs };
}

export async function testConnection(
  creds: OutlookCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    // A successful token refresh confirms the OAuth credentials are valid and active
    await refreshAccessToken(creds);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown Outlook error',
      latencyMs: Date.now() - start,
    };
  }
}
