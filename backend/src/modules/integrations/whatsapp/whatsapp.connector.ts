/**
 * WhatsApp Cloud API connector.
 *
 * Auth: Bearer token in `Authorization` header. Credentials shape:
 *   { phoneNumberId: string, apiToken: string, apiVersion?: string }
 *
 * Vendor docs (verified 2026-06):
 *   Send message: POST https://graph.facebook.com/{apiVersion}/PHONE_NUMBER_ID/messages
 *   Verify token: GET  /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *   Sign payload : HMAC-SHA256(rawBody, appSecret), hex digest, header X-Hub-Signature-256: sha256=<hex>
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName } from '../integrations.repository';
import { findCredentialsById } from '../integrations.repository';
import { loggedFetch, type ConnectorResult } from '../connector.base';

export const WHATSAPP_PROVIDER_NAME = 'whatsapp';

export const whatsappCredentialsSchema = z
  .object({
    phoneNumberId: z.string().min(1, 'phoneNumberId is required'),
    apiToken: z.string().min(1, 'apiToken is required'),
    apiVersion: z.string().default('v20.0'),
    /** Optional app secret used to verify inbound webhook HMAC-SHA256 signatures. */
    appSecret: z.string().optional(),
  })
  .strict();

export type WhatsappCredentials = z.infer<typeof whatsappCredentialsSchema>;

export interface SendMessageMedia {
  /** Public URL — the Cloud API fetches the file itself, it does not accept uploads inline. */
  url: string;
  mimeType: string;
  filename: string;
}

export interface SendMessageInput {
  leadId: string;
  campaignId?: string | null;
  to: string; // E.164 phone number
  body: string;
  /** Optional template name (required for outbound session messages outside 24h window). */
  templateName?: string;
  templateLanguage?: string;
  templateVariables?: string[];
  /** When set, sends an image/document message instead of plain text —
   *  the Cloud API allows only one message "type" per call, so a media
   *  message carries `body` as its caption rather than as a separate text message. */
  media?: SendMessageMedia;
}

function whatsappMediaKind(mimeType: string): 'image' | 'document' {
  return mimeType.startsWith('image/') ? 'image' : 'document';
}

export interface SendMessageOutput {
  externalId: string | undefined;
  latencyMs: number;
}

/**
 * Loads + validates credentials for the WhatsApp integration.
 * Throws AppError(404) if the integration row is missing, AppError(422) if
 * the stored credential blob doesn't match the expected shape.
 */
export async function loadCredentials(): Promise<WhatsappCredentials> {
  const row = await findByName(WHATSAPP_PROVIDER_NAME);
  if (!row) throw new AppError('WhatsApp integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('WhatsApp credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`WhatsApp credential decryption failed: ${message}`, 422);
  }
  const result = whatsappCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `WhatsApp credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

/**
 * Sends a text or template message through the WhatsApp Cloud API.
 * Result is returned even on failure — never throws for HTTP errors.
 */
export async function sendMessage(
  input: SendMessageInput,
): Promise<ConnectorResult<SendMessageOutput>> {
  const creds = await loadCredentials();
  const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.phoneNumberId}/messages`;

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: input.to,
  };
  if (input.media) {
    const kind = whatsappMediaKind(input.media.mimeType);
    payload.type = kind;
    payload[kind] =
      kind === 'image'
        ? { link: input.media.url, caption: input.body || undefined }
        : {
            link: input.media.url,
            filename: input.media.filename,
            caption: input.body || undefined,
          };
  } else if (input.templateName) {
    payload.type = 'template';
    payload.template = {
      name: input.templateName,
      language: { code: input.templateLanguage ?? 'en' },
      components: input.templateVariables
        ? [
            {
              type: 'body',
              parameters: input.templateVariables.map((v) => ({ type: 'text', text: v })),
            },
          ]
        : undefined,
    };
  } else {
    payload.type = 'text';
    payload.text = { body: input.body };
  }

  const res = await loggedFetch<unknown>(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    {
      channel: 'whatsapp',
      leadId: input.leadId,
      campaignId: input.campaignId,
      context: { to: maskPhone(input.to) },
    },
  );

  if (!res.ok) {
    return { ...res, error: res.error };
  }
  const externalId = res.externalId;
  return {
    ok: true,
    status: res.status,
    data: { externalId, latencyMs: res.latencyMs },
    externalId,
    latencyMs: res.latencyMs,
  };
}

function maskPhone(p: string): string {
  if (p.length <= 4) return '***';
  return `${p.slice(0, 2)}***${p.slice(-2)}`;
}

export async function testConnection(
  creds: WhatsappCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.phoneNumberId}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${creds.apiToken}`,
      },
    });

    if (res.ok) {
      return { ok: true, latencyMs: Date.now() - start };
    }

    // Attempt to parse error
    let errorMessage = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error && body.error.message) {
        errorMessage = body.error.message;
      }
    } catch {
      // Ignore JSON parse error
    }

    return { ok: false, error: errorMessage, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown WhatsApp error',
      latencyMs: Date.now() - start,
    };
  }
}
