import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName } from '../integrations.repository';
import { findCredentialsById } from '../integrations.repository';
import { loggedFetch, type ConnectorResult } from '../connector.base';

/**
 * SendGrid v3 Mail Send connector.
 *
 * Auth: Bearer API key (sg. ...) in `Authorization` header.
 * Credentials shape:
 *   { apiKey: string, fromEmail: string, fromName?: string }
 *
 * Vendor docs (verified 2026-06):
 *   Send mail: POST https://api.sendgrid.com/v3/mail/send
 *   Auth     : Authorization: Bearer <SG.xxxxxxxx>
 *   Webhooks : POST events delivered to a configured endpoint — verified via
 *              a shared "Event Webhook Secret" using ECDSA signature in
 *              `X-Twilio-Email-Event-Webhook-Signature` and timestamp in
 *              `X-Twilio-Email-Event-Webhook-Timestamp`. We verify that
 *              header + timestamp + raw body via the shared secret.
 */

export const SENDGRID_PROVIDER_NAME = 'sendgrid';

export const sendgridCredentialsSchema = z
  .object({
    apiKey: z
      .string()
      .regex(/^SG\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}$/, 'apiKey must look like SG.xxxxx'),
    fromEmail: z.string().email('fromEmail must be a valid email'),
    fromName: z.string().max(120).optional(),
  })
  .strict();

export type SendgridCredentials = z.infer<typeof sendgridCredentialsSchema>;

export interface SendEmailInput {
  leadId: string;
  campaignId?: string | null;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

export interface SendEmailOutput {
  externalId: string | undefined;
  latencyMs: number;
}

export async function loadCredentials(): Promise<SendgridCredentials> {
  const row = await findByName(SENDGRID_PROVIDER_NAME);
  if (!row) throw new AppError('SendGrid integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('SendGrid credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`SendGrid credential decryption failed: ${message}`, 422);
  }
  const result = sendgridCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `SendGrid credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

export async function sendEmail(input: SendEmailInput): Promise<ConnectorResult<SendEmailOutput>> {
  const creds = await loadCredentials();
  const url = 'https://api.sendgrid.com/v3/mail/send';

  const body = {
    personalizations: [{ to: [{ email: input.to }] }],
    from: { email: creds.fromEmail, name: creds.fromName },
    subject: input.subject,
    content: [
      { type: 'text/plain', value: input.textBody ?? stripHtml(input.htmlBody) },
      { type: 'text/html', value: input.htmlBody },
    ],
  };

  const res = await loggedFetch<unknown>(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    {
      channel: 'sendgrid',
      leadId: input.leadId,
      campaignId: input.campaignId,
      context: { to_domain: input.to.split('@')[1] ?? 'unknown' },
    },
  );

  if (!res.ok) return res;
  return {
    ok: true,
    status: res.status,
    data: { externalId: res.externalId, latencyMs: res.latencyMs },
    externalId: res.externalId,
    latencyMs: res.latencyMs,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
