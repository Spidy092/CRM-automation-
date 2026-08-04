/**
 * Signature verification helpers for all supported webhook providers.
 *
 * Each provider uses a different verification mechanism:
 *   - WhatsApp: HMAC-SHA256 of raw request body against app secret
 *   - Twilio: HMAC-SHA1 of URL + params against auth token
 *   - SendGrid: HMAC-SHA256 with verification key (if configured)
 *   - Google Ads: Shared secret comparison (simple token match)
 */
import crypto from 'crypto';
import { logger } from '../shared/utils/logger';

/**
 * Verify WhatsApp Cloud API webhook signature.
 * Facebook signs the raw request body with HMAC-SHA256 using the app secret.
 * The signature is passed in the X-Hub-Signature-256 header as `sha256=<hex>`.
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) {
    logger.warn('WhatsApp webhook missing signature header');
    return false;
  }

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) {
    logger.warn('WhatsApp webhook invalid signature format');
    return false;
  }

  const receivedSig = signatureHeader.slice(expectedPrefix.length);
  const computedSig = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(computedSig));
  } catch {
    return false;
  }
}

/**
 * Verify Twilio webhook signature.
 * Twilio signs the URL + POST parameters with HMAC-SHA1 using the auth token.
 * The signature is passed in the X-Twilio-Signature header.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) {
    logger.warn('Twilio webhook missing signature header');
    return false;
  }

  // Build the signature string: URL + sorted params concatenated
  const sortedKeys = Object.keys(params).sort();
  let sigStr = url;
  for (const key of sortedKeys) {
    sigStr += key + params[key];
  }

  const computedSig = crypto.createHmac('sha1', authToken).update(sigStr, 'utf8').digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(computedSig));
  } catch {
    return false;
  }
}

/**
 * Verify SendGrid webhook signature (signed events).
 * SendGrid signs events with HMAC-SHA256 using a verification key configured
 * in the SendGrid dashboard.
 */
export function verifySendGridSignature(
  payload: string,
  signatureHeader: string | undefined,
  verificationKey: string | undefined,
): boolean {
  if (!verificationKey) {
    logger.error('SendGrid verification key not configured — rejecting unverified webhook');
    return false;
  }

  if (!signatureHeader) {
    logger.warn('SendGrid webhook missing signature header');
    return false;
  }

  const computedSig = crypto
    .createHmac('sha256', verificationKey)
    .update(payload, 'utf8')
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(computedSig));
  } catch {
    return false;
  }
}

/**
 * Verify Google Ads webhook shared secret.
 * Google Ads lead form webhooks include a `secret` field in the payload
 * that must match the configured value.
 */
export function verifyGoogleAdsSecret(
  payloadSecret: string | undefined,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret) {
    logger.error('Google Ads webhook secret not configured — rejecting unverified webhook');
    return false;
  }

  if (!payloadSecret) {
    logger.warn('Google Ads webhook missing secret in payload');
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(payloadSecret), Buffer.from(configuredSecret));
  } catch {
    return false;
  }
}
