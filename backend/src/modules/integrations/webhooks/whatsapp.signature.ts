import crypto from 'crypto';

/**
 * WhatsApp Cloud API — verify HMAC-SHA256 signature on inbound webhooks.
 *
 * Reference: https://developers.facebook.com/docs/messenger-platform/webhooks#verify-webhook
 *
 *   Header : X-Hub-Signature-256: sha256=<hex>
 *   Algorithm: HMAC-SHA256(rawRequestBody, appSecret)
 *   Constant-time comparison via crypto.timingSafeEqual.
 *
 * NOTE: Express body-parser MUST run BEFORE this middleware, and the body
 * MUST be the raw bytes (no JSON parsing). For `express.json`, mount this
 * on a route that uses `express.raw({ type: 'application/json' })` so the
 * raw buffer survives.
 */
export function verifyWhatsappSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header) return false;
  const expectedPrefix = 'sha256=';
  if (!header.startsWith(expectedPrefix)) return false;
  const provided = header.slice(expectedPrefix.length).trim();
  if (provided.length === 0) return false;

  const computed = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  if (provided.length !== computed.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(computed, 'hex'));
  } catch {
    return false;
  }
}
