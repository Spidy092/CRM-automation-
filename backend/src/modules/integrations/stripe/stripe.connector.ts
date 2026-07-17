/**
 * Stripe connector.
 *
 * Auth: Bearer <secretKey>
 * Credentials shape: { secretKey: string, webhookSecret?: string }
 *
 * Vendor docs: https://stripe.com/docs/api
 * Base URL: https://api.stripe.com/v1
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';

export const STRIPE_PROVIDER_NAME = 'stripe';

export const stripeCredentialsSchema = z
  .object({
    secretKey:     z.string().min(1, 'Secret key is required').startsWith('sk_', 'Must start with sk_'),
    webhookSecret: z.string().optional(),
  })
  .strict();

export type StripeCredentials = z.infer<typeof stripeCredentialsSchema>;

const STRIPE_BASE = 'https://api.stripe.com/v1';

function authHeader(secretKey: string): string {
  return `Bearer ${secretKey}`;
}

export async function loadCredentials(): Promise<StripeCredentials> {
  const row = await findByName(STRIPE_PROVIDER_NAME);
  if (!row) throw new AppError('Stripe integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('Stripe credentials not set', 422);
  const raw = JSON.parse(decrypt(enc)) as unknown;
  const result = stripeCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(`Stripe credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`, 422);
  }
  return result.data;
}

/**
 * Fetches /v1/balance — a lightweight read-only endpoint with no side-effects.
 */
export async function testConnection(
  creds: StripeCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${STRIPE_BASE}/balance`, {
      headers: { Authorization: authHeader(creds.secretKey) },
    });
    if (res.ok) return { ok: true, latencyMs: Date.now() - start };
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json() as { error?: { message?: string } };
      if (b.error?.message) msg = b.error.message;
    } catch { /* ignore */ }
    return { ok: false, error: msg, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: Date.now() - start };
  }
}

export interface CreatePaymentLinkInput {
  priceId?: string;
  amount?: number;   // in paise/cents
  currency?: string;
  description?: string;
}

/**
 * Creates a Stripe Payment Link (if no priceId, creates a one-off price first).
 */
export async function createPaymentLink(
  input: CreatePaymentLinkInput,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const creds = await loadCredentials();

  try {
    let priceId = input.priceId;

    // If no existing price ID, create a one-off price
    if (!priceId) {
      const priceBody = new URLSearchParams({
        unit_amount: String(input.amount ?? 0),
        currency:    input.currency ?? 'inr',
        'product_data[name]': input.description ?? 'CRM Deal',
      });
      const priceRes = await fetch(`${STRIPE_BASE}/prices`, {
        method: 'POST',
        headers: {
          Authorization: authHeader(creds.secretKey),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: priceBody,
      });
      if (!priceRes.ok) {
        const b = await priceRes.json() as { error?: { message?: string } };
        return { ok: false, error: b.error?.message ?? 'Failed to create price' };
      }
      const priceData = await priceRes.json() as { id: string };
      priceId = priceData.id;
    }

    // Create payment link
    const linkBody = new URLSearchParams({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1' });
    const linkRes = await fetch(`${STRIPE_BASE}/payment_links`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(creds.secretKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: linkBody,
    });
    if (!linkRes.ok) {
      const b = await linkRes.json() as { error?: { message?: string } };
      return { ok: false, error: b.error?.message ?? 'Failed to create payment link' };
    }
    const linkData = await linkRes.json() as { url: string };
    return { ok: true, url: linkData.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
