/**
 * Mailchimp Marketing API connector.
 *
 * Auth: Basic auth — username = "anystring", password = apiKey
 * Credentials shape: { apiKey: string, serverPrefix: string, listId?: string }
 *
 * Vendor docs: https://mailchimp.com/developer/marketing/api/
 * Base URL: https://<serverPrefix>.api.mailchimp.com/3.0
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

export const MAILCHIMP_PROVIDER_NAME = 'mailchimp';

export const mailchimpCredentialsSchema = z
  .object({
    apiKey:       z.string().min(1, 'API key is required'),
    serverPrefix: z.string().min(1, 'Server prefix is required (e.g. us1)'),
    listId:       z.string().optional(),
  })
  .strict();

export type MailchimpCredentials = z.infer<typeof mailchimpCredentialsSchema>;

function baseUrl(prefix: string): string {
  return `https://${prefix}.api.mailchimp.com/3.0`;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`;
}

export async function loadCredentials(): Promise<MailchimpCredentials> {
  const row = await findByName(MAILCHIMP_PROVIDER_NAME);
  if (!row) throw new AppError('Mailchimp integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Mailchimp credentials not set', 422);
  const raw = JSON.parse(decrypt(enc)) as unknown;
  const result = mailchimpCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(`Mailchimp credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`, 422);
  }
  return result.data;
}

export async function testConnection(
  creds: MailchimpCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl(creds.serverPrefix)}/ping`, {
      headers: { Authorization: authHeader(creds.apiKey) },
    });
    if (res.ok) return { ok: true, latencyMs: Date.now() - start };
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json() as { detail?: string }; if (b.detail) msg = b.detail; } catch { /* ignore */ }
    return { ok: false, error: msg, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: Date.now() - start };
  }
}

export interface MailchimpContact {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
}

/**
 * Adds or updates a contact in the given Mailchimp audience list.
 * Uses the MD5 hash of the lowercase email as the subscriber hash (Mailchimp requirement).
 */
export async function upsertContact(
  listId: string,
  contact: MailchimpContact,
): Promise<{ ok: boolean; error?: string }> {
  const creds = await loadCredentials();
  const target = listId || creds.listId;
  if (!target) return { ok: false, error: 'No Mailchimp list ID configured' };

  const { createHash } = await import('crypto');
  const hash = createHash('md5').update(contact.email.toLowerCase()).digest('hex');

  try {
    const res = await fetch(`${baseUrl(creds.serverPrefix)}/lists/${target}/members/${hash}`, {
      method: 'PUT',
      headers: {
        Authorization: authHeader(creds.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: contact.email,
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: contact.firstName ?? '',
          LNAME: contact.lastName ?? '',
        },
        tags: contact.tags ?? [],
      }),
    });
    if (res.ok) return { ok: true };
    const b = await res.json() as { detail?: string };
    return { ok: false, error: b.detail ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
