import crypto from 'crypto';
import { logger } from '../shared/utils/logger';

/**
 * Verify Facebook Lead Ads webhook signature.
 * Facebook/Meta signs the raw request body with HMAC-SHA256 using the app secret.
 * The signature is passed in the X-Hub-Signature-256 header as `sha256=<hex>`.
 *
 * Note: This uses the same mechanism as the WhatsApp webhook since both are
 * Meta products and share the same signature format.
 */
export function verifyFacebookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) {
    logger.warn('Facebook webhook missing signature header');
    return false;
  }

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) {
    logger.warn('Facebook webhook invalid signature format');
    return false;
  }

  const receivedSig = signatureHeader.slice(expectedPrefix.length);
  const computedSig = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(computedSig));
  } catch {
    return false;
  }
}
