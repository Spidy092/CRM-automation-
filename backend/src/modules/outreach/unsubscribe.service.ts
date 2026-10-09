import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { redis } from '../../shared/utils/redis';
import { AppError } from '../../shared/middleware/errorHandler';

const payloadSchema = z.object({
  leadId: z.string().uuid(),
  emailHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

/** Redis stores the digest, never the bearer token included in the email. */
function tokenKey(token: string): string {
  return `outreach:unsubscribe:${createHash('sha256').update(token).digest('hex')}`;
}

/** Issue an opaque, email-bound opt-out link without exposing a lead ID or address. */
export async function createOutreachUnsubscribeUrl(leadId: string, email: string): Promise<string> {
  const base = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
  const url = new URL('/outreach/unsubscribe', base);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
  ) {
    throw new AppError('Outreach unsubscribe requires a valid public application URL', 500);
  }
  const payload = payloadSchema.parse({
    leadId,
    emailHash: createHash('sha256').update(email.trim().toLowerCase()).digest('hex'),
  });
  const token = randomBytes(32).toString('hex');
  await redis.set(tokenKey(token), JSON.stringify(payload), 'EX', TOKEN_TTL_SECONDS);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Confirm an email recipient's opt-out; retained tokens make retries idempotent. */
export async function unsubscribeOutreachRecipient(token: string): Promise<void> {
  const stored = await redis.get(tokenKey(token));
  if (!stored) throw new AppError('This unsubscribe link is invalid or expired', 404);
  const payload = payloadSchema.parse(JSON.parse(stored) as unknown);
  const { optOutLeadByEmail } = await import('../leads/leads.service');
  await optOutLeadByEmail(payload.leadId, payload.emailHash);
}
