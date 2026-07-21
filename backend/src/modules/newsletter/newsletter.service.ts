import crypto from 'crypto';
import { AppError } from '../../shared/middleware/errorHandler';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { clampLimit } from '../../shared/utils/pagination';
import * as sendgrid from '../integrations/sendgrid/sendgrid.connector';
import * as smtp from '../integrations/smtp/smtp.connector';
import {
  findSubscriberByEmail,
  findSubscriberById,
  findSubscriberByUnsubscribeTokenHash,
  insertSubscriber,
  resetToPending,
  markConfirmed,
  markUnsubscribed,
  updatePreferences as updatePreferencesRow,
  findSubscribers,
  countSubscribers,
} from './newsletter.repository';
import {
  NewsletterSubscriberRow,
  NewsletterSubscriberStatus,
  NewsletterFrequency,
  NewsletterResult,
} from './newsletter.types';

const CONFIRM_TOKEN_TTL_SECONDS = 60 * 60 * 48; // 48 hours

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function confirmTokenKey(tokenHash: string): string {
  return `newsletter:confirm_token:${tokenHash}`;
}

async function sendSystemEmail(
  to: string,
  subject: string,
  htmlBody: string,
  leadId: string,
): Promise<void> {
  const emailInput = { to, subject, htmlBody, leadId };

  try {
    const sgRes = await sendgrid.sendEmail(emailInput);
    if (sgRes.ok) return;
  } catch (err) {
    logger.warn('SendGrid failed for newsletter email, falling back to SMTP', {
      error: (err as Error).message,
    });
  }

  try {
    await smtp.sendEmail(emailInput);
  } catch (err) {
    logger.error('SMTP failed for newsletter email', { error: (err as Error).message });
  }
}

async function sendConfirmationEmail(subscriberId: string, email: string): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  await redis.set(confirmTokenKey(tokenHash), subscriberId, 'EX', CONFIRM_TOKEN_TTL_SECONDS);

  const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const confirmUrl = `${baseUrl}/newsletter/confirm?token=${rawToken}`;

  await sendSystemEmail(
    email,
    'Confirm your newsletter subscription',
    `<p>Please confirm your subscription by clicking the link below:</p>
     <p><a href="${confirmUrl}">Confirm subscription</a></p>
     <p>If you didn't request this, you can safely ignore this email.</p>`,
    subscriberId,
  );
}

export async function subscribe(
  email: string,
  topics: string[],
  frequency: NewsletterFrequency,
  source: string | null,
): Promise<NewsletterResult<{ message: string }, AppError>> {
  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await findSubscriberByEmail(normalizedEmail);
    const genericMessage = 'Thanks! Please check your inbox to confirm your subscription.';

    // Already confirmed: no-op, no resend, no signal to the caller either way
    // (avoids using subscribe as an email-existence oracle).
    if (existing && existing.status === 'confirmed') {
      return { ok: true, value: { message: genericMessage } };
    }

    const subscriberId = existing
      ? (await resetToPending(existing.id, topics, frequency)).id
      : (
          await insertSubscriber({
            email: normalizedEmail,
            topics,
            frequency,
            unsubscribeTokenHash: hashToken(crypto.randomBytes(32).toString('hex')),
            source,
          })
        ).id;

    await sendConfirmationEmail(subscriberId, normalizedEmail);

    return { ok: true, value: { message: genericMessage } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to subscribe';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function confirmSubscription(
  token: string,
): Promise<NewsletterResult<{ message: string }, AppError>> {
  try {
    const key = confirmTokenKey(hashToken(token));
    const subscriberId = await redis.get(key);
    if (!subscriberId) {
      return { ok: false, error: new AppError('Invalid or expired confirmation token', 400) };
    }
    await markConfirmed(subscriberId);
    await redis.del(key);
    return { ok: true, value: { message: 'Subscription confirmed.' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to confirm subscription';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function unsubscribe(
  token: string,
): Promise<NewsletterResult<{ message: string }, AppError>> {
  try {
    const subscriber = await findSubscriberByUnsubscribeTokenHash(hashToken(token));
    if (!subscriber) {
      return { ok: false, error: new AppError('Invalid unsubscribe link', 404) };
    }
    if (subscriber.status !== 'unsubscribed') {
      await markUnsubscribed(subscriber.id);
    }
    return { ok: true, value: { message: 'You have been unsubscribed.' } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to unsubscribe';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function getPreferences(
  token: string,
): Promise<
  NewsletterResult<
    { topics: string[]; frequency: NewsletterFrequency; status: NewsletterSubscriberStatus },
    AppError
  >
> {
  try {
    const subscriber = await findSubscriberByUnsubscribeTokenHash(hashToken(token));
    if (!subscriber) {
      return { ok: false, error: new AppError('Invalid preferences link', 404) };
    }
    return {
      ok: true,
      value: {
        topics: subscriber.topics,
        frequency: subscriber.frequency,
        status: subscriber.status,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load preferences';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function updateSubscriberPreferences(
  token: string,
  updates: { topics?: string[]; frequency?: NewsletterFrequency },
): Promise<NewsletterResult<NewsletterSubscriberRow, AppError>> {
  try {
    const subscriber = await findSubscriberByUnsubscribeTokenHash(hashToken(token));
    if (!subscriber) {
      return { ok: false, error: new AppError('Invalid preferences link', 404) };
    }
    if (subscriber.status === 'unsubscribed') {
      return {
        ok: false,
        error: new AppError('Cannot update preferences for an unsubscribed address', 400),
      };
    }
    const row = await updatePreferencesRow(subscriber.id, updates);
    return { ok: true, value: row };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update preferences';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function listSubscribers(
  limit?: number,
  offset?: number,
  status?: NewsletterSubscriberStatus,
): Promise<
  NewsletterResult<
    { items: NewsletterSubscriberRow[]; meta: { limit: number; offset: number; total: number } },
    AppError
  >
> {
  try {
    const safeLimit = clampLimit(limit);
    const safeOffset = Math.max(0, offset ?? 0);
    const [items, total] = await Promise.all([
      findSubscribers(safeLimit, safeOffset, status),
      countSubscribers(status),
    ]);
    return { ok: true, value: { items, meta: { limit: safeLimit, offset: safeOffset, total } } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list subscribers';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function getSubscriberById(
  id: string,
): Promise<NewsletterResult<NewsletterSubscriberRow, AppError>> {
  try {
    const row = await findSubscriberById(id);
    if (!row) return { ok: false, error: new AppError('Subscriber not found', 404) };
    return { ok: true, value: row };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load subscriber';
    return { ok: false, error: new AppError(message, 500) };
  }
}
