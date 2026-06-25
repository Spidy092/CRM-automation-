/**
 * SMTP fallback email connector (Nodemailer).
 *
 * Used when SendGrid is not configured or fails. Credentials shape:
 *   { host: string, port: number, secure?: boolean, user: string, pass: string,
 *     fromEmail: string, fromName?: string }
 *
 * Vendor docs: https://nodemailer.com/about/
 */

import nodemailer from 'nodemailer';
import { z } from 'zod';
import { decryptJson } from '../../../shared/utils/encryption';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { logger } from '../../../shared/utils/logger';

export const SMTP_PROVIDER_NAME = 'smtp';

export const smtpCredentialsSchema = z
  .object({
    host: z.string().min(1, 'host is required'),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().default(false),
    user: z.string().min(1, 'user is required'),
    pass: z.string().min(1, 'pass is required'),
    fromEmail: z.string().email('fromEmail must be a valid email'),
    fromName: z.string().max(120).optional(),
  })
  .strict();

export type SmtpCredentials = z.infer<typeof smtpCredentialsSchema>;

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

export type SmtpResult =
  | { ok: true; externalId?: string; latencyMs: number }
  | { ok: false; error: string; retryable: boolean; latencyMs: number };

export async function loadCredentials(): Promise<SmtpCredentials> {
  const row = await findByName(SMTP_PROVIDER_NAME);
  if (!row) throw new AppError('SMTP integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('SMTP credentials not set', 422);

  let parsed: unknown;
  try {
    parsed = decryptJson<unknown>(enc);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new AppError(`SMTP credential decryption failed: ${message}`, 422);
  }
  const result = smtpCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      `SMTP credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`,
      422,
    );
  }
  return result.data;
}

export async function sendEmail(input: SendEmailInput): Promise<SmtpResult> {
  const start = Date.now();

  let creds: SmtpCredentials;
  try {
    creds = await loadCredentials();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn('SMTP loadCredentials failed', {
      channel: 'smtp',
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      error: message,
    });
    return { ok: false, error: message, retryable: false, latencyMs: Date.now() - start };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
    });

    const info = await transporter.sendMail({
      from: creds.fromName
        ? `"${creds.fromName}" <${creds.fromEmail}>`
        : creds.fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.textBody ?? input.htmlBody.replace(/<[^>]*>/g, ''),
      html: input.htmlBody,
    });

    const latencyMs = Date.now() - start;
    const externalId = (info.messageId as string | undefined)?.replace(/[<>]/g, '');

    logger.info('SMTP email sent', {
      channel: 'smtp',
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      status: 'sent',
      latency_ms: latencyMs,
    });

    return { ok: true, externalId, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error('SMTP email failed', {
      channel: 'smtp',
      lead_id: input.leadId,
      campaign_id: input.campaignId,
      error: message,
      latency_ms: latencyMs,
    });
    return { ok: false, error: message, retryable: true, latencyMs };
  }
}
