import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName } from '../integrations.repository';
import { findCredentialsById } from '../integrations.repository';
import { loggedFetch, type ConnectorResult } from '../connector.base';

/**
 * Twilio Programmable Messaging + SMS connector.
 *
 * Auth: HTTP Basic — Account SID + Auth Token (NEVER query string for prod).
 * Credentials shape:
 *   { accountSid: string, authToken: string, fromNumber: string }
 *
 * Vendor docs (verified 2026-06):
 *   Send SMS : POST https://api.twilio.com/2010-04-01/Accounts/{Sid}/Messages.json
 *   Auth     : Authorization: Basic base64(Sid:Token)
 *   Verify   : X-Twilio-Signature header = HMAC-SHA1(URL + sortedParams, authToken)
 */

export const TWILIO_PROVIDER_NAME = 'twilio';

export const twilioCredentialsSchema = z
  .object({
    accountSid: z
      .string()
      .regex(/^AC[a-f0-9]{32}$/i, 'accountSid must look like ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
    authToken: z.string().min(1, 'authToken is required'),
    fromNumber: z.string().min(1, 'fromNumber is required (E.164)'),
  })
  .strict();

export type TwilioCredentials = z.infer<typeof twilioCredentialsSchema>;

export interface SendSmsInput {
  leadId: string;
  campaignId?: string | null;
  to: string;
  body: string;
}

export interface SendSmsOutput {
  externalId: string | undefined;
  latencyMs: number;
}

export async function loadCredentials(): Promise<TwilioCredentials> {
  const row = await findByName(TWILIO_PROVIDER_NAME);
  if (!row) throw new AppError('Twilio integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Twilio credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`Twilio credential decryption failed: ${message}`, 422);
  }
  const result = twilioCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `Twilio credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

export async function sendSms(input: SendSmsInput): Promise<ConnectorResult<SendSmsOutput>> {
  const creds = await loadCredentials();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const basic = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');

  const body = new URLSearchParams({
    To: input.to,
    From: creds.fromNumber,
    Body: input.body,
  }).toString();

  const res = await loggedFetch<unknown>(
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    {
      channel: 'twilio',
      leadId: input.leadId,
      campaignId: input.campaignId,
      context: { to: input.to.slice(0, 4) + '***' },
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
