/**
 * Zapier Webhook connector.
 *
 * Auth: No header auth — the webhook URL itself is the secret.
 * Credentials shape: { webhookUrl: string }
 *
 * Zapier Catch Hook: https://zapier.com/developer/documentation/v2/triggers/#rest-hooks
 * The webhook URL is provided in the Zapier editor when you add a "Webhooks by Zapier" trigger.
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

export const ZAPIER_PROVIDER_NAME = 'zapier';

const zapierWebhookUrlSchema = z
  .string()
  .url('Webhook URL must be a valid URL')
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      // z.string().url() reports this case; keep the refinement defensive.
      return;
    }

    // The webhook URL is a bearer secret, not a generic HTTP destination. An
    // exact Zapier host allowlist prevents an admin-configured URL from turning
    // the connector into an SSRF or arbitrary data-exfiltration primitive.
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'hooks.zapier.com') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Webhook URL must use HTTPS and the hooks.zapier.com host',
      });
    }
    if (parsed.username || parsed.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Webhook URL must not include embedded credentials',
      });
    }
  });

export const zapierCredentialsSchema = z
  .object({
    webhookUrl: zapierWebhookUrlSchema,
  })
  .strict();

export type ZapierCredentials = z.infer<typeof zapierCredentialsSchema>;

export async function loadCredentials(providedCredentials?: unknown): Promise<ZapierCredentials> {
  let raw: unknown = providedCredentials;
  if (raw === undefined) {
    const row = await findByName(ZAPIER_PROVIDER_NAME);
    if (!row) throw new AppError('Zapier integration not configured', 404);
    const enc = await findCredentialsById(row.id);
    if (!enc) throw new AppError('Zapier credentials not set', 422);
    raw = JSON.parse(decrypt(enc)) as unknown;
  }
  const result = zapierCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      `Zapier credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

/**
 * Sends a test payload to the Zapier webhook URL.
 * Zapier responds with 200 + {"status":"success"} if the hook is active.
 */
export async function testConnection(
  creds: ZapierCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(creds.webhookUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'crm.test',
        source: 'crm-integration-test',
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10000),
    });
    // Zapier returns 200 for active hooks, anything else is an error
    if (res.status === 200) return { ok: true, latencyMs: Date.now() - start };
    return {
      ok: false,
      error: `Zapier responded with HTTP ${res.status}`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      latencyMs: Date.now() - start,
    };
  }
}

export type ZapierEventName =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.won'
  | 'lead.lost'
  | 'campaign.launched'
  | 'outreach.replied';

export interface ZapierEventPayload {
  event: ZapierEventName;
  leadId?: string;
  campaignId?: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Triggers the Zapier webhook with a structured CRM event payload.
 * Returns ok:true even if Zapier responded with a non-200 status — callers decide whether to retry.
 */
export async function triggerEvent(
  payload: ZapierEventPayload,
): Promise<{ ok: boolean; error?: string }> {
  const creds = await loadCredentials();
  try {
    const res = await fetch(creds.webhookUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 200) return { ok: true };
    return { ok: false, error: `Zapier responded with HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
