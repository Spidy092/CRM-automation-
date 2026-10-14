import crypto from 'crypto';
import OpenAI from 'openai';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  enqueueNewsletterBroadcast,
  toggleNewsletterAutomatedDigest,
  newsletterQueue,
  NEWSLETTER_AUTOMATED_DIGEST,
} from '../../workers/queue';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { clampLimit } from '../../shared/utils/pagination';
import { emailHtmlToText } from '../integrations/emailContent';
import { localDateTimeInZoneToUtc } from './newsletter.timezone';
import * as sendgrid from '../integrations/sendgrid/sendgrid.connector';
import * as smtp from '../integrations/smtp/smtp.connector';
import {
  findSubscriberByEmail,
  findSubscriberById,
  findSubscriberByUnsubscribeToken,
  insertSubscriber,
  resetToPending,
  markConfirmed,
  markUnsubscribed,
  updatePreferences as updatePreferencesRow,
  updateUnsubscribeTokenHash,
  createSubscriberToken,
  isMissingRelationError,
  isTokenTableAvailable,
  findSubscribers,
  countSubscribers,
  countSubscribersByStatus,
  countEligibleSubscribers,
  createBroadcast,
  findBroadcastById,
  findBroadcastByIdempotencyKey,
  findBroadcastContent,
  findBroadcastFrequencies,
  hasRecipientOutcomes,
  setBroadcastContent,
  listBroadcastHistoryRows,
  listFailedRecipientIds,
  listUncertainRecipientIds,
  listUncertainRecipientIdsForBroadcasts,
  type NewsletterBroadcastRow,
} from './newsletter.repository';
import {
  NewsletterSubscriberRow,
  NewsletterSubscriberStatus,
  NewsletterFrequency,
  NewsletterDigestConfig,
  NewsletterBroadcastInput,
  NewsletterDigestStatus,
  NewsletterDigestDraft,
  NewsletterResult,
} from './newsletter.types';

const CONFIRM_TOKEN_TTL_SECONDS = 60 * 60 * 48; // 48 hours

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Mint a fresh raw unsubscribe token, persist only its hash, return the raw. */
export async function mintUnsubscribeToken(subscriberId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await updateUnsubscribeTokenHash(subscriberId, hashToken(raw));
  return raw;
}

/**
 * Mint a per-send token WITHOUT invalidating older links: appends a row to
 * `newsletter_subscriber_tokens` (migration 0081) and never touches existing
 * rows, so links in previously sent legitimate emails keep resolving.
 *
 * Fail-closed: when migration 0081 has not been applied, this THROWS an
 * actionable setup error instead of rotating the single stored hash (which
 * would invalidate every older link). Sends are gated on this before any
 * dispatch — see `triggerBroadcast` and the worker startup probe.
 */
export async function mintBroadcastToken(
  subscriberId: string,
  label?: string,
): Promise<{ raw: string }> {
  const raw = crypto.randomBytes(32).toString('hex');
  try {
    await createSubscriberToken(subscriberId, hashToken(raw), label);
    return { raw };
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    throw new AppError(
      'Newsletter token storage is not set up: run migration 0081 ' +
        '(newsletter_subscriber_tokens) before sending. No email was sent and no existing links were changed.',
      503,
    );
  }
}

/** True for Redis connectivity failures (enqueue must surface 503, not 500). */
function isRedisConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (
    typeof code === 'string' &&
    ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE'].includes(code)
  ) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /redis|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|Connection is closed|maxRetriesPerRequest|connect timed? ?out/i.test(
    message,
  );
}

function queueUnavailableError(): AppError {
  return new AppError(
    'Newsletter queue unavailable — Redis is unreachable. Nothing was enqueued; retry shortly.',
    503,
  );
}

/**
 * Stranded-broadcast check for the idempotency path. A broadcast row alone
 * does NOT prove its job was enqueued: a queue outage between row creation
 * and `add()` strands it in `scheduled`, and the old code answered every
 * retry with "deduplicated" — the send never happened.
 *
 * - Terminal row (completed/partially_failed/failed) → `duplicate-confirmed`:
 *   a worker finished it. Never resend, even if the job record is gone.
 * - Live job (active/delayed/wait/prioritized/paused/waiting-children,
 *   and `unknown` conservatively) → `pending`: true duplicate, no resend.
 * - Completed job but non-terminal row (worker died after the last send
 *   before the status update) → `duplicate-confirmed`: sends happened;
 *   resending would duplicate. The stuck row is logged for operators.
 * - Failed job → `job.retry()` under the SAME job id (claim namespace and
 *   receipts preserved, so accepted recipients still skip) → `recovered`.
 *   If retry is impossible, remove the dead record so the caller can
 *   re-add the same id → `requeue`.
 * - No job record + non-terminal row → `requeue`: never enqueued (outage)
 *   or cleaned after retention while unfinished. The caller re-adds under
 *   the SAME job id, so surviving claims/receipts still protect against
 *   duplicates.
 */
async function checkStrandedBroadcast(
  broadcastId: string,
  idempotencyKey: string,
  rowStatus: string,
): Promise<'pending' | 'recovered' | 'duplicate-confirmed' | 'requeue'> {
  if (rowStatus === 'completed' || rowStatus === 'partially_failed' || rowStatus === 'failed') {
    return 'duplicate-confirmed';
  }
  const jobId = `newsletter-broadcast-${idempotencyKey}`;
  let job: {
    getState: () => Promise<string>;
    retry: () => Promise<void>;
    remove: () => Promise<void>;
  } | null;
  try {
    job = (await newsletterQueue.getJob(jobId)) as typeof job | null;
  } catch (err) {
    // Cannot verify while the queue is unreachable: fail closed rather
    // than claim a duplicate OR enqueue blindly.
    if (isRedisConnectionError(err)) throw queueUnavailableError();
    throw err;
  }
  if (!job) return 'requeue';
  let state: string;
  try {
    state = await job.getState();
  } catch (err) {
    if (isRedisConnectionError(err)) throw queueUnavailableError();
    throw err;
  }
  if (state === 'completed') {
    logger.warn('Newsletter broadcast row stuck non-terminal after job completion', {
      broadcastId,
      jobId,
    });
    return 'duplicate-confirmed';
  }
  if (state === 'failed') {
    try {
      await job.retry();
      logger.info('Newsletter stranded broadcast recovered via job retry', { broadcastId, jobId });
      return 'recovered';
    } catch (err) {
      logger.warn('Newsletter job retry impossible — removing dead record for requeue', {
        broadcastId,
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await job.remove();
      } catch {
        // Best-effort: re-adding the same id is still safe via claims.
      }
      return 'requeue';
    }
  }
  return 'pending';
}

/**
 * Resolve a subscriber from a preference/unsubscribe token.
 * Accepts both current raw tokens (hashed before lookup) and legacy links
 * that embedded the stored hash directly. Never logs the token.
 */
async function resolveSubscriberByToken(token: string): Promise<NewsletterSubscriberRow | null> {
  return findSubscriberByUnsubscribeToken(token, hashToken);
}

function confirmTokenKey(tokenHash: string): string {
  return `newsletter:confirm_token:${tokenHash}`;
}

/** Escape admin-composed preview text / subject fragments placed into HTML. */
export function escapeHtmlFragment(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBroadcastHtml(
  htmlBody: string,
  opts: { previewText?: string; prefsUrl: string; unsubUrl: string },
): { html: string; text: string } {
  const preview = opts.previewText
    ? `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtmlFragment(opts.previewText)}</span>`
    : '';
  const footer =
    `<br/><br/><hr/>` +
    `<p style="font-size: 12px; color: #666;">` +
    `You are receiving this because you subscribed to our newsletter.<br/>` +
    `<a href="${opts.prefsUrl}">Update Preferences</a> | ` +
    `<a href="${opts.unsubUrl}">Unsubscribe</a></p>`;
  const html = `${preview}${htmlBody}${footer}`;
  return { html, text: emailHtmlToText(html) };
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
    // Security-sensitive: token is a bearer secret. Look up via dual
    // (hashed + legacy) match; never log the token or the stored hash.
    const subscriber = await resolveSubscriberByToken(token);
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
    const subscriber = await resolveSubscriberByToken(token);
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
    const subscriber = await resolveSubscriberByToken(token);
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
  filters?: { search?: string; topic?: string; source?: string; frequency?: NewsletterFrequency },
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
      findSubscribers(safeLimit, safeOffset, status, filters),
      countSubscribers(status, filters),
    ]);
    return { ok: true, value: { items, meta: { limit: safeLimit, offset: safeOffset, total } } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list subscribers';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/** Audience-wide summary counts, independent of current list filters/page. */
export async function getSubscriberCounts(): Promise<
  NewsletterResult<
    { pending: number; confirmed: number; unsubscribed: number; total: number },
    AppError
  >
> {
  try {
    const counts = await countSubscribersByStatus();
    return { ok: true, value: counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to count subscribers';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function getEligibleRecipientCount(targeting?: {
  topics?: string[];
  frequency?: NewsletterFrequency | NewsletterFrequency[];
}): Promise<NewsletterResult<{ eligible: number }, AppError>> {
  try {
    const eligible = await countEligibleSubscribers(targeting);
    return { ok: true, value: { eligible } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to count eligible recipients';
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

const EXPORT_BATCH_SIZE = 1000;
/** Hard safety cap: exceeded only via an explicit 422, never silent truncation. */
const EXPORT_MAX_ROWS = 50000;

/**
 * Quote one CSV cell and neutralize formula injection (OWASP): cells whose
 * first character is `=`, `+`, `-`, `@`, tab, or carriage return are
 * prefixed with a single quote so spreadsheet apps never execute them.
 */
export function escapeCsvCell(value: string | null): string {
  if (value === null || value === undefined) return '';
  const needsQuote = /[",\n\r]/.test(value) || /^[=+\-@\t\r]/.test(value);
  const inner = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return needsQuote ? `"${inner.replace(/"/g, '""')}"` : inner;
}

/**
 * Export EVERY subscriber matching the filters using safe batching — never
 * silently truncated. Returns the CSV plus the exact row count so the
 * controller can advertise it (`X-Newsletter-Export-Total`). Exceeding the
 * safety cap is an explicit 422 asking the caller to narrow filters.
 *
 * Note: only persisted lifecycle timestamps are exported; no consent
 * timestamps are fabricated or inferred from CRM lead membership.
 */
export async function exportSubscribersCsv(filters?: {
  status?: NewsletterSubscriberStatus;
  search?: string;
  topic?: string;
  source?: string;
  frequency?: NewsletterFrequency;
}): Promise<NewsletterResult<{ csv: string; total: number }, AppError>> {
  try {
    const lines = ['email,status,topics,frequency,source,confirmed_at,unsubscribed_at,created_at'];
    let offset = 0;
    let total = 0;
    for (;;) {
      const batch = await findSubscribers(EXPORT_BATCH_SIZE, offset, filters?.status, {
        ...(filters?.search ? { search: filters.search } : {}),
        ...(filters?.topic ? { topic: filters.topic } : {}),
        ...(filters?.source ? { source: filters.source } : {}),
        ...(filters?.frequency ? { frequency: filters.frequency } : {}),
      });
      for (const s of batch) {
        total += 1;
        if (total > EXPORT_MAX_ROWS) {
          return {
            ok: false,
            error: new AppError(
              `Export exceeds ${EXPORT_MAX_ROWS} rows — narrow the filters and retry`,
              422,
            ),
          };
        }
        lines.push(
          [
            escapeCsvCell(s.email),
            escapeCsvCell(s.status),
            escapeCsvCell((s.topics ?? []).join(';')),
            escapeCsvCell(s.frequency),
            escapeCsvCell(s.source),
            escapeCsvCell(s.confirmed_at),
            escapeCsvCell(s.unsubscribed_at),
            escapeCsvCell(s.created_at),
          ].join(','),
        );
      }
      if (batch.length < EXPORT_BATCH_SIZE) break;
      offset += EXPORT_BATCH_SIZE;
    }
    return { ok: true, value: { csv: lines.join('\n'), total } };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    const message = err instanceof Error ? err.message : 'Failed to export subscribers';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function triggerBroadcast(
  subject: string,
  htmlBody: string,
  opts?: NewsletterBroadcastInput,
  actor?: { id: string },
): Promise<
  NewsletterResult<
    {
      enqueued: boolean;
      broadcastId?: string;
      scheduledAt?: string;
      scheduledAtLocal?: string;
      ambiguous?: boolean;
      eligible?: number;
      deduplicated?: boolean;
      /** True when a stranded broadcast was recovered (re-enqueued/retried). */
      recovered?: boolean;
      persistence?: 'database' | 'redis';
    },
    AppError
  >
> {
  try {
    // Setup gate (fail closed): per-send tokens require migration 0081. When
    // the table is absent we refuse to enqueue rather than rotate the single
    // stored hash and invalidate every older link. Actionable, before any
    // queue or history write.
    if (!(await isTokenTableAvailable())) {
      return {
        ok: false,
        error: new AppError(
          'Newsletter sending is not set up: run migration 0081 ' +
            '(newsletter_subscriber_tokens) before sending broadcasts. Nothing was enqueued.',
          503,
        ),
      };
    }
    // Resolve wall-clock scheduling in the selected timezone to the correct
    // UTC instant. An absolute `scheduledAt` (API compat) is used as-is.
    let scheduledAtUtc: string | undefined;
    let ambiguous = false;
    if (opts?.scheduledAtLocal) {
      const resolved = localDateTimeInZoneToUtc(opts.scheduledAtLocal, opts?.timezone ?? 'UTC');
      scheduledAtUtc = resolved.utcIso;
      ambiguous = resolved.ambiguous;
    } else if (opts?.scheduledAt) {
      scheduledAtUtc = opts.scheduledAt;
    }
    // Durable row first (migrations 0079+0082; both pending approval): the
    // worker transitions it scheduled -> processing -> terminal and upserts
    // per-recipient outcomes. Missing tables degrade to Redis-only history.
    let broadcastId: string | undefined;
    let persistence: 'database' | 'redis' = 'redis';
    let recovered = false;
    let requeueRow: NewsletterBroadcastRow | null = null;
    try {
      if (opts?.idempotencyKey) {
        const existing = await findBroadcastByIdempotencyKey(opts.idempotencyKey);
        if (existing) {
          // A row alone does NOT prove the job was enqueued: a queue outage
          // between row creation and enqueue strands the broadcast. Verify
          // the BullMQ job before claiming a duplicate.
          const action = await checkStrandedBroadcast(
            existing.id,
            opts.idempotencyKey,
            existing.status,
          );
          if (action === 'pending' || action === 'duplicate-confirmed') {
            return {
              ok: true,
              value: {
                enqueued: false,
                broadcastId: existing.id,
                deduplicated: true,
                persistence: 'database',
              },
            };
          }
          if (action === 'recovered') {
            return {
              ok: true,
              value: {
                enqueued: true,
                broadcastId: existing.id,
                deduplicated: true,
                recovered: true,
                persistence: 'database',
              },
            };
          }
          // 'requeue': reuse the existing row and fall through to enqueue
          // under the SAME job id, so surviving claims/receipts still guard
          // against duplicate sends. Content resolution happens below: a
          // regenerated payload must never replace already-sent content.
          broadcastId = existing.id;
          persistence = 'database';
          recovered = true;
          requeueRow = existing;
        }
      }
      if (!broadcastId) {
        const row = await createBroadcast({
          subject,
          ...(opts?.previewText ? { previewText: opts.previewText } : {}),
          ...(opts?.topics ? { topics: opts.topics } : {}),
          ...(opts?.frequency ? { frequency: opts.frequency } : {}),
          ...(opts?.frequencies ? { frequencies: opts.frequencies } : {}),
          timezone: opts?.timezone ?? 'UTC',
          ...(scheduledAtUtc ? { scheduledAtUtc } : {}),
          ...(actor ? { createdBy: actor.id } : {}),
          ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
          status: 'scheduled',
        });
        await setBroadcastContent(row.id, { htmlBody }).catch(() => undefined);
        broadcastId = row.id;
        persistence = 'database';
      }
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      // Migrations not yet run: continue with Redis-only history.
    }
    // Resolved send payload. Defaults to the current call; the requeue path
    // below may pin it to the ORIGINAL broadcast instead (content lock).
    let send = {
      subject,
      htmlBody,
      previewText: opts?.previewText,
      topics: opts?.topics,
      frequency: opts?.frequency,
      frequencies: opts?.frequencies,
      timezone: opts?.timezone ?? 'UTC',
      scheduledAtUtc,
      scheduledAtLocal: opts?.scheduledAtLocal,
      templateId: opts?.templateId,
    };
    if (requeueRow) {
      // Content lock: regeneration on retry must never replace what was
      // already sent under this identity.
      let sentBefore = false;
      try {
        sentBefore = await hasRecipientOutcomes(requeueRow.id);
      } catch (err) {
        if (!isMissingRelationError(err)) throw err;
      }
      if (sentBefore) {
        const original = await findBroadcastContent(requeueRow.id).catch(() => null);
        const originalFrequencies = await findBroadcastFrequencies([requeueRow.id]).catch(
          () => ({}) as Record<string, NewsletterFrequency[]>,
        );
        if (!original?.htmlBody) {
          // Original content is unavailable (e.g. 0079-only database) and
          // sends happened: resending anything would risk a divergent
          // duplicate. Refuse loudly instead of guessing.
          return {
            ok: false,
            error: new AppError(
              'Original broadcast content is unavailable for safe retry; create a new broadcast instead',
              409,
            ),
          };
        }
        send = {
          subject: requeueRow.subject,
          htmlBody: original.htmlBody,
          previewText: requeueRow.preview_text ?? undefined,
          topics: requeueRow.topics ?? undefined,
          frequency: requeueRow.frequency ?? undefined,
          frequencies: originalFrequencies[requeueRow.id],
          timezone: requeueRow.timezone ?? 'UTC',
          scheduledAtUtc: requeueRow.scheduled_at ?? undefined,
          scheduledAtLocal: undefined,
          templateId: undefined,
        };
      } else {
        // Nothing was ever sent: sync the row so row ≡ job, then send.
        await setBroadcastContent(requeueRow.id, {
          subject,
          htmlBody,
          previewText: opts?.previewText,
        }).catch(() => undefined);
      }
    }
    // Eligible count is computed at enqueue time for the review step; the
    // worker rechecks eligibility per recipient immediately before dispatch
    // (pending/unsubscribed/suppressed are always excluded). Counted against
    // the RESOLVED payload so requeue-original counts match what will send.
    const targeting =
      send.topics || send.frequency || send.frequencies
        ? { topics: send.topics, frequency: send.frequencies ?? send.frequency }
        : undefined;
    const { value } = await getEligibleRecipientCount(targeting).then((r) =>
      r.ok ? { value: r.value.eligible } : { value: undefined },
    );
    let jobId: string | undefined;
    try {
      jobId = await enqueueNewsletterBroadcast({
        subject: send.subject,
        htmlBody: send.htmlBody,
        previewText: send.previewText,
        topics: send.topics,
        frequency: send.frequency,
        ...(send.frequencies ? { frequencies: send.frequencies } : {}),
        scheduledAt: send.scheduledAtUtc,
        ...(send.scheduledAtLocal ? { scheduledAtLocal: send.scheduledAtLocal } : {}),
        timezone: send.timezone,
        idempotencyKey: opts?.idempotencyKey,
        templateId: send.templateId,
        ...(broadcastId ? { broadcastRecordId: broadcastId } : {}),
      });
    } catch (err) {
      // Fail closed on queue/Redis outage: report 503 so the caller retries
      // shortly. Never enqueue partially or claim success. The durable row
      // (if created) intentionally stays `scheduled`: the idempotency retry
      // path re-verifies the missing job and requeues under the same id.
      // Marking it terminal here would strand it behind `duplicate-confirmed`.
      if (isRedisConnectionError(err)) return { ok: false, error: queueUnavailableError() };
      throw err;
    }
    if (broadcastId) {
      await setBroadcastContent(broadcastId, { jobId }).catch(() => undefined);
    }
    return {
      ok: true,
      value: {
        enqueued: true,
        ...(broadcastId ? { broadcastId } : {}),
        ...(send.scheduledAtUtc ? { scheduledAt: send.scheduledAtUtc } : {}),
        ...(send.scheduledAtLocal ? { scheduledAtLocal: send.scheduledAtLocal } : {}),
        ...(send.scheduledAtLocal ? { ambiguous } : {}),
        ...(value !== undefined ? { eligible: value } : {}),
        ...(recovered ? { recovered: true as const } : {}),
        persistence,
      },
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    const message = err instanceof Error ? err.message : 'Failed to enqueue broadcast';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/**
 * Test-send to an explicitly selected address only. Never sends to lead
 * addresses harvested elsewhere. Uses the same footer builder so the test
 * email previews the real layout (with a placeholder token notice).
 */
export async function sendNewsletterTest(
  to: string,
  subject: string,
  htmlBody: string,
  previewText?: string,
): Promise<NewsletterResult<{ sent: boolean; channel: string }, AppError>> {
  try {
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const notice = 'test-token-not-a-real-subscriber-token';
    const { html, text } = buildBroadcastHtml(htmlBody, {
      ...(previewText ? { previewText } : {}),
      prefsUrl: `${baseUrl}/newsletter/preferences?token=${encodeURIComponent(notice)}`,
      unsubUrl: `${baseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(notice)}`,
    });
    const emailInput = { to, subject, htmlBody: html, textBody: text, leadId: `newsletter-test` };
    const sgRes = await sendgrid.sendEmail(emailInput).catch((err: unknown) => ({
      ok: false as const,
      status: 0,
      error: err instanceof Error ? err.message : 'SendGrid failed',
      latencyMs: 0,
      retryable: true as const,
    }));
    if (sgRes.ok) {
      logger.info('Newsletter test email accepted by provider', { channel: 'sendgrid' });
      return { ok: true, value: { sent: true, channel: 'sendgrid' } };
    }
    const smtpRes = await smtp.sendEmail(emailInput);
    if (smtpRes.ok) {
      logger.info('Newsletter test email accepted by provider', { channel: 'smtp' });
      return { ok: true, value: { sent: true, channel: 'smtp' } };
    }
    return {
      ok: false,
      error: new AppError(
        `Test email was not accepted by any provider (sendgrid: ${'error' in sgRes ? sgRes.error : 'failed'}; smtp: ${smtpRes.error})`,
        502,
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send test email';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function toggleAutomatedDigest(
  enabled: boolean,
): Promise<NewsletterResult<{ enabled: boolean }, AppError>> {
  try {
    await toggleNewsletterAutomatedDigest(enabled);
    // Persist the flag in Redis as well so a page refresh (and worker
    // restarts) observe the same state even before repeatable-job metadata
    // propagates. The repeatable job remains the source of truth for the
    // schedule; this key is a fast read-model for the UI.
    await redis.set(DIGEST_ENABLED_REDIS_KEY, enabled ? '1' : '0');
    return { ok: true, value: { enabled } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to toggle automated digest';
    return { ok: false, error: new AppError(message, 500) };
  }
}

const DIGEST_CONFIG_REDIS_KEY = 'newsletter:digest:config';
const DIGEST_ENABLED_REDIS_KEY = 'newsletter:digest:enabled';
const DIGEST_AUTO_SEND_REDIS_KEY = 'newsletter:digest:auto_send';
const DIGEST_LAST_OUTCOME_REDIS_KEY = 'newsletter:digest:last_outcome';
const DIGEST_DRAFT_REDIS_KEY = 'newsletter:digest:draft';

export const DIGEST_SCHEDULE_CRON = '0 9 * * 5';
export const DIGEST_SCHEDULE_LABEL = 'Fridays 09:00';
export const DIGEST_SCHEDULE_TIMEZONE = 'UTC';

export const DEFAULT_DIGEST_CONFIG: NewsletterDigestConfig = {
  topic: 'Weekly Sales Tips & Growth Hacks',
  tone: 'professional',
  customPrompt: 'Provide actionable sales techniques and productivity advice.',
  targetAudience: 'Sales reps and business professionals',
};

export async function getDigestConfig(): Promise<
  NewsletterResult<NewsletterDigestConfig, AppError>
> {
  try {
    const raw = await redis.get(DIGEST_CONFIG_REDIS_KEY);
    if (!raw) {
      return { ok: true, value: DEFAULT_DIGEST_CONFIG };
    }
    const parsed = JSON.parse(raw) as NewsletterDigestConfig;
    return { ok: true, value: { ...DEFAULT_DIGEST_CONFIG, ...parsed } };
  } catch (err) {
    return { ok: true, value: DEFAULT_DIGEST_CONFIG };
  }
}

export async function updateDigestConfig(
  config: NewsletterDigestConfig,
): Promise<NewsletterResult<NewsletterDigestConfig, AppError>> {
  try {
    await redis.set(DIGEST_CONFIG_REDIS_KEY, JSON.stringify(config));
    return { ok: true, value: config };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update digest config';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/**
 * Persisted digest status for the UI. Refresh-safe: `enabled` is read from
 * the Redis flag (written by toggle) and cross-checked against BullMQ
 * repeatable jobs (the schedule source of truth). `nextRunAt` comes from
 * real repeatable-job metadata when available, otherwise null (labelled
 * honestly as unavailable). `lastOutcome` is written by the digest worker on
 * every run — never invented.
 */
export async function getDigestStatus(): Promise<
  NewsletterResult<NewsletterDigestStatus, AppError>
> {
  try {
    const [enabledRaw, autoSendRaw, lastOutcomeRaw] = await Promise.all([
      redis.get(DIGEST_ENABLED_REDIS_KEY).catch(() => null),
      redis.get(DIGEST_AUTO_SEND_REDIS_KEY).catch(() => null),
      redis.get(DIGEST_LAST_OUTCOME_REDIS_KEY).catch(() => null),
    ]);
    let repeatableEnabled: boolean | null = null;
    let nextRunAt: string | null = null;
    try {
      const repeatables = await newsletterQueue.getRepeatableJobs();
      const digestJobs = repeatables.filter((j) => j.name === NEWSLETTER_AUTOMATED_DIGEST);
      repeatableEnabled = digestJobs.length > 0;
      const withNext = digestJobs.find(
        (j) => typeof (j as { next?: number }).next === 'number',
      ) as unknown as { next?: number } | undefined;
      if (withNext?.next) nextRunAt = new Date(withNext.next).toISOString();
    } catch {
      repeatableEnabled = null;
    }
    // Redis flag wins when set (immediate UI consistency after toggle);
    // otherwise fall back to the repeatable-job source of truth.
    const enabled = enabledRaw !== null ? enabledRaw === '1' : (repeatableEnabled ?? false);
    let lastOutcome: NewsletterDigestStatus['lastOutcome'] = {
      status: 'never_run',
      message: 'No automated digest run has been recorded yet.',
      at: null,
    };
    if (lastOutcomeRaw) {
      try {
        lastOutcome = JSON.parse(lastOutcomeRaw) as NewsletterDigestStatus['lastOutcome'];
      } catch {
        // Keep the default; a corrupt outcome must not break the status read.
      }
    }
    return {
      ok: true,
      value: {
        enabled,
        schedule: `${DIGEST_SCHEDULE_CRON} (${DIGEST_SCHEDULE_LABEL})`,
        timezone: DIGEST_SCHEDULE_TIMEZONE,
        nextRunAt: enabled ? nextRunAt : null,
        autoSend: autoSendRaw === '1',
        lastOutcome,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load digest status';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function recordDigestOutcome(outcome: {
  status: 'success' | 'failed' | 'needs_review';
  message: string;
}): Promise<void> {
  try {
    await redis.set(
      DIGEST_LAST_OUTCOME_REDIS_KEY,
      JSON.stringify({ ...outcome, at: new Date().toISOString() }),
    );
  } catch (err) {
    logger.warn('Failed to record newsletter digest outcome', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function setDigestAutoSend(
  autoSend: boolean,
): Promise<NewsletterResult<{ autoSend: boolean }, AppError>> {
  try {
    await redis.set(DIGEST_AUTO_SEND_REDIS_KEY, autoSend ? '1' : '0');
    return { ok: true, value: { autoSend } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update digest auto-send';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function getDigestDraft(): Promise<
  NewsletterResult<{ draft: NewsletterDigestDraft | null; autoSend: boolean }, AppError>
> {
  try {
    const [raw, autoSendRaw] = await Promise.all([
      redis.get(DIGEST_DRAFT_REDIS_KEY).catch(() => null),
      redis.get(DIGEST_AUTO_SEND_REDIS_KEY).catch(() => null),
    ]);
    return {
      ok: true,
      value: {
        draft: raw ? (JSON.parse(raw) as NewsletterDigestDraft) : null,
        autoSend: autoSendRaw === '1',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load digest draft';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function saveDigestDraft(
  draft: { subject: string; htmlBody: string },
  note?: string,
): Promise<NewsletterResult<NewsletterDigestDraft, AppError>> {
  try {
    const now = new Date().toISOString();
    let prev: NewsletterDigestDraft | null = null;
    try {
      const raw = await redis.get(DIGEST_DRAFT_REDIS_KEY);
      prev = raw ? (JSON.parse(raw) as NewsletterDigestDraft) : null;
    } catch {
      prev = null;
    }
    const next: NewsletterDigestDraft = {
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      status: 'draft',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      ...(note ? { note } : {}),
    };
    await redis.set(DIGEST_DRAFT_REDIS_KEY, JSON.stringify(next));
    await recordDigestOutcome({ status: 'needs_review', message: 'AI draft is ready for review.' });
    return { ok: true, value: next };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save digest draft';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export async function approveDigestDraft(): Promise<
  NewsletterResult<{ enqueued: boolean; eligible?: number }, AppError>
> {
  try {
    const raw = await redis.get(DIGEST_DRAFT_REDIS_KEY);
    if (!raw) return { ok: false, error: new AppError('No digest draft to approve', 404) };
    const draft = JSON.parse(raw) as NewsletterDigestDraft;
    const result = await triggerBroadcast(draft.subject, draft.htmlBody);
    if (!result.ok) throw result.error;
    const now = new Date().toISOString();
    await redis.set(
      DIGEST_DRAFT_REDIS_KEY,
      JSON.stringify({ ...draft, status: 'approved' as const, updatedAt: now }),
    );
    return { ok: true, value: result.value };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to approve digest draft';
    return { ok: false, error: new AppError(message, 500) };
  }
}

export interface NewsletterBroadcastHistoryItem {
  id: string;
  subject: string;
  status: 'completed' | 'partially_failed' | 'failed' | 'processing' | 'scheduled' | 'draft';
  topics: string[];
  frequency: string | null;
  /** Frequency list for automated sends (digest targets daily + weekly). */
  frequencies?: string[];
  timezone: string;
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  /** Sends with UNKNOWN outcome (crash between claim and receipt). Never auto-resent. */
  uncertain: number;
  /** Bounded actionable ids for operator review (see retry `includeUncertain`). */
  uncertainIds: string[];
  failureCount: number;
  finishedAt: string;
  createdBy: string | null;
  /** Where this item came from — the UI labels redis history as best-effort. */
  source: 'database' | 'redis';
  /** Provider-event metrics are only available via webhooks; labelled honestly. */
  delivered: null;
  bounced: null;
  clicked: null;
  unsubscribed: null;
}

/**
 * Broadcast history, durable-first: reads `newsletter_broadcasts`
 * (migrations 0079+0082) when available, otherwise the Redis worker outcome
 * records (30-day TTL). No invented metrics: only attempted/provider-
 * accepted/failed counts are reported. Delivered/bounced/clicked/
 * unsubscribed stay null until a dedicated newsletter event ingestion
 * exists — the UI labels them "Unavailable — no provider event feed".
 * Each item carries `source` so the UI can label durability honestly.
 */
export async function listBroadcastHistory(
  limit = 50,
): Promise<NewsletterResult<{ items: NewsletterBroadcastHistoryItem[] }, AppError>> {
  try {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    try {
      const rows = await listBroadcastHistoryRows(safeLimit, 0);
      const uncertainByBroadcast = await listUncertainRecipientIdsForBroadcasts(
        rows.filter((r) => r.uncertain > 0).map((r) => r.id),
      ).catch(() => ({}) as Record<string, string[]>);
      // Audience frequency lists (0083, best-effort): merged here so digest
      // rows read honestly instead of falling back to "any frequency".
      const frequenciesByBroadcast = await findBroadcastFrequencies(rows.map((r) => r.id)).catch(
        () => ({}) as Record<string, NewsletterFrequency[]>,
      );
      return {
        ok: true,
        value: {
          items: rows.map((r) => ({
            id: r.id,
            subject: r.subject,
            status: r.status,
            topics: r.topics ?? [],
            frequency: r.frequency ?? null,
            ...(frequenciesByBroadcast[r.id]?.length
              ? { frequencies: frequenciesByBroadcast[r.id] }
              : {}),
            timezone: r.timezone ?? 'UTC',
            attempted: r.attempted,
            accepted: r.accepted,
            failed: r.failed,
            skipped: r.skipped,
            uncertain: r.uncertain,
            uncertainIds: uncertainByBroadcast[r.id] ?? [],
            failureCount: r.failed,
            finishedAt: r.updated_at,
            createdBy: r.created_by,
            source: 'database' as const,
            delivered: null,
            bounced: null,
            clicked: null,
            unsubscribed: null,
          })),
        },
      };
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      // Migrations not yet run: Redis-only history (best-effort).
    }
    const items: NewsletterBroadcastHistoryItem[] = [];
    let cursor = '0';
    do {
      const [next, keys]: [string, string[]] = await (
        redis as unknown as {
          scan: (cursor: string, ...args: unknown[]) => Promise<[string, string[]]>;
        }
      ).scan(cursor, 'MATCH', 'newsletter:broadcast:outcome:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys.slice(0, safeLimit - items.length)) {
        try {
          const raw = await redis.get(key);
          if (!raw) continue;
          const o = JSON.parse(raw) as {
            subject: string;
            status: 'completed' | 'partially_failed' | 'failed' | 'processing';
            topics: string[];
            frequency: string | null;
            frequencies?: string[];
            timezone: string;
            attempted: number;
            accepted: number;
            failed: number;
            skipped: number;
            uncertain?: number;
            uncertainIds?: string[];
            failures: unknown[];
            finishedAt: string;
          };
          items.push({
            id: key.replace('newsletter:broadcast:outcome:', ''),
            subject: o.subject,
            status: o.status,
            topics: o.topics ?? [],
            frequency: o.frequency ?? null,
            ...(Array.isArray(o.frequencies) ? { frequencies: o.frequencies } : {}),
            timezone: o.timezone ?? 'UTC',
            attempted: o.attempted,
            accepted: o.accepted,
            failed: o.failed,
            skipped: o.skipped,
            uncertain: o.uncertain ?? 0,
            uncertainIds: Array.isArray(o.uncertainIds) ? o.uncertainIds.slice(0, 50) : [],
            failureCount: Array.isArray(o.failures) ? o.failures.length : 0,
            finishedAt: o.finishedAt,
            createdBy: null,
            source: 'redis',
            delivered: null,
            bounced: null,
            clicked: null,
            unsubscribed: null,
          });
        } catch {
          continue;
        }
      }
    } while (cursor !== '0' && items.length < safeLimit);
    items.sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
    return { ok: true, value: { items: items.slice(0, safeLimit) } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list broadcast history';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/**
 * Operator review list for uncertain sends: which recipients have UNKNOWN
 * outcomes and need an explicit retry decision. Same admin RBAC as the
 * retry endpoint. Emails are included on the durable path; on the Redis
 * path only ids are available (Redis stores no email index).
 */
export async function listUncertainRecipients(
  broadcastId: string,
): Promise<
  NewsletterResult<{ items: Array<{ subscriberId: string; email: string | null }> }, AppError>
> {
  try {
    try {
      const ids = (await listUncertainRecipientIds(broadcastId)).slice(0, 200);
      const items = await Promise.all(
        ids.map(async (subscriberId) => {
          const row = await findSubscriberById(subscriberId).catch(() => null);
          return { subscriberId, email: row?.email ?? null };
        }),
      );
      return { ok: true, value: { items } };
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
    const raw = await redis.get(`newsletter:broadcast:outcome:${broadcastId}`).catch(() => null);
    if (!raw) return { ok: true, value: { items: [] } };
    const o = JSON.parse(raw) as { uncertainIds?: unknown };
    const ids = Array.isArray(o.uncertainIds)
      ? (o.uncertainIds as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 200)
      : [];
    return {
      ok: true,
      value: { items: ids.map((subscriberId) => ({ subscriberId, email: null })) },
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    const message = err instanceof Error ? err.message : 'Failed to list uncertain recipients';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/**
 * Targeted failed-recipient recovery: enqueue a retry job carrying ONLY the
 * failed recipient ids. Successful recipients are never re-enqueued, and the
 * worker rechecks consent/eligibility per recipient before every send.
 *
 * Uncertain recipients (claim orphaned by a crash — outcome UNKNOWN) are
 * EXCLUDED unless the operator explicitly passes `includeUncertain: true`,
 * having reviewed the uncertain list. Retrying them can duplicate a send
 * the provider already performed; that risk is the operator's informed
 * decision, never an automatic one.
 *
 * Content is resolved durably-first: the broadcast DB row (html_body), else
 * the retained BullMQ job payload. If neither survives, the retry is an
 * explicit 404 — never a silent no-op or a resend of invented content.
 */
export async function retryFailedRecipients(
  broadcastId: string,
  actor?: { id: string },
  flags?: { includeUncertain?: boolean },
): Promise<
  NewsletterResult<
    { enqueued: boolean; broadcastId?: string; retrying?: number; retryingUncertain?: number },
    AppError
  >
> {
  try {
    let subject: string | undefined;
    let htmlBody: string | undefined;
    let previewText: string | undefined;
    let topics: string[] | undefined;
    let frequency: NewsletterBroadcastInput['frequency'];
    let frequencies: NewsletterFrequency[] | undefined;
    let timezone = 'UTC';
    let failedIds: string[] = [];
    let uncertainIds: string[] = [];
    let durable = false;

    try {
      const row = await findBroadcastById(broadcastId);
      if (row) {
        durable = true;
        subject = row.subject;
        previewText = row.preview_text ?? undefined;
        topics = row.topics ?? [];
        frequency = row.frequency ?? undefined;
        // Digest-originated rows carry their audience as a frequency list.
        frequencies = (
          await findBroadcastFrequencies([row.id]).catch(
            () => ({}) as Record<string, NewsletterFrequency[]>,
          )
        )[row.id];
        timezone = row.timezone ?? 'UTC';
        failedIds = await listFailedRecipientIds(broadcastId);
        if (flags?.includeUncertain) {
          uncertainIds = await listUncertainRecipientIds(broadcastId);
        }
        const content = (row as NewsletterBroadcastRow & { html_body?: string | null }).html_body;
        // html_body lives in the 0082 columns; read it directly when present.
        if (content) htmlBody = content;
      }
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }

    if (!durable) {
      // Redis fallback: outcome record carries failures; content comes from
      // the retained BullMQ job payload (24h/count-1000 retention).
      const raw = await redis.get(`newsletter:broadcast:outcome:${broadcastId}`).catch(() => null);
      if (raw) {
        const o = JSON.parse(raw) as {
          subject: string;
          topics: string[];
          frequency: NewsletterBroadcastInput['frequency'];
          frequencies?: NewsletterFrequency[];
          timezone: string;
          failures: Array<{ subscriberId: string }>;
          uncertainIds?: string[];
        };
        subject = o.subject;
        topics = o.topics ?? [];
        frequency = o.frequency;
        if (Array.isArray(o.frequencies)) frequencies = o.frequencies;
        timezone = o.timezone ?? 'UTC';
        failedIds = (o.failures ?? []).map((f) => f.subscriberId);
        if (flags?.includeUncertain && Array.isArray(o.uncertainIds)) {
          uncertainIds = o.uncertainIds;
        }
      }
      try {
        const job = await newsletterQueue.getJob(broadcastId);
        const data = job?.data as { htmlBody?: string; previewText?: string } | undefined;
        if (data?.htmlBody) {
          htmlBody = data.htmlBody;
          previewText = data.previewText;
        }
      } catch {
        // BullMQ lookup is best-effort here.
      }
    }

    if (!subject || !htmlBody) {
      return {
        ok: false,
        error: new AppError('Original broadcast content is no longer available for retry', 404),
      };
    }
    const retryIds = [...failedIds, ...uncertainIds];
    if (retryIds.length === 0) {
      return {
        ok: false,
        error: new AppError(
          flags?.includeUncertain
            ? 'No failed or uncertain recipients to retry'
            : 'No failed recipients to retry',
          409,
        ),
      };
    }

    const retryKey = `${broadcastId}-retry-${Date.now()}`;
    let retryRecordId: string | undefined;
    try {
      const row = await createBroadcast({
        subject,
        ...(previewText ? { previewText } : {}),
        ...(topics ? { topics } : {}),
        ...(frequency ? { frequency } : {}),
        timezone,
        ...(actor ? { createdBy: actor.id } : {}),
        idempotencyKey: retryKey,
        status: 'scheduled',
      });
      await setBroadcastContent(row.id, { htmlBody }).catch(() => undefined);
      retryRecordId = row.id;
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }

    let jobId: string | undefined;
    try {
      jobId = await enqueueNewsletterBroadcast({
        subject,
        htmlBody,
        ...(previewText ? { previewText } : {}),
        ...(topics ? { topics } : {}),
        ...(frequency ? { frequency } : {}),
        ...(frequencies ? { frequencies } : {}),
        timezone,
        idempotencyKey: retryKey,
        ...(retryRecordId ? { broadcastRecordId: retryRecordId } : {}),
        recipientIds: retryIds,
        retryOf: broadcastId,
      });
    } catch (err) {
      if (isRedisConnectionError(err)) return { ok: false, error: queueUnavailableError() };
      throw err;
    }
    if (retryRecordId) {
      await setBroadcastContent(retryRecordId, { jobId }).catch(() => undefined);
    }
    return {
      ok: true,
      value: {
        enqueued: true,
        broadcastId: retryRecordId,
        retrying: failedIds.length,
        retryingUncertain: uncertainIds.length,
      },
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    const message = err instanceof Error ? err.message : 'Failed to enqueue retry';
    return { ok: false, error: new AppError(message, 500) };
  }
}

/**
 * Durable history integration is implemented in this service against
 * append-only migrations 0079 + 0082 — both written but NOT run (pending
 * approval). Until they run, every DB call degrades to the Redis path and
 * history items carry source:'redis'. Do not claim durable history is live
 * merely because the migration files exist; check `source` at runtime.
 */
export interface AiDigestGeneration {
  subject: string;
  htmlBody: string;
  tokensUsed: number | null;
}

/**
 * Generate AI digest content. Follows project AI rules: max_tokens capped at
 * 500, prompts contain only topic/tone/audience (never subscriber PII), and
 * failures fall back visibly (throw + record outcome) instead of sending
 * silently-degraded content.
 */
export async function generateDigestContent(): Promise<AiDigestGeneration> {
  const { getAiConfig } = await import('../ai-settings/ai-settings.service');
  const aiConfig = await getAiConfig().catch(() => null);
  const configRes = await getDigestConfig();
  const digestConfig = configRes.ok ? configRes.value : DEFAULT_DIGEST_CONFIG;
  const apiKey = aiConfig?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AppError('OPENAI_API_KEY missing; cannot generate digest', 422);
  const client = new OpenAI({ apiKey, baseURL: aiConfig?.baseUrl || undefined });
  const topic = digestConfig.topic || DEFAULT_DIGEST_CONFIG.topic;
  const tone = digestConfig.tone || 'professional';
  const targetAudience = digestConfig.targetAudience || DEFAULT_DIGEST_CONFIG.targetAudience;
  const customPrompt = digestConfig.customPrompt || DEFAULT_DIGEST_CONFIG.customPrompt;
  const completion = await client.chat.completions.create({
    model: aiConfig?.model || 'gpt-4o',
    max_tokens: Math.min(aiConfig?.maxTokens || 500, 500),
    temperature: aiConfig?.temperature ?? 0.7,
    messages: [
      {
        role: 'system',
        content:
          aiConfig?.systemPromptOverride ||
          `You are an expert CRM assistant drafting a weekly newsletter digest. Tone: ${tone}. Target Audience: ${targetAudience}. Keep it under 200 words, highly engaging, and beautifully structured.`,
      },
      {
        role: 'user',
        content: `Topic: ${topic}.\nGuidelines: ${customPrompt}\nWrite an engaging newsletter tip/digest post for our subscribers. Do not include markdown headers (# or ##), write clear HTML paragraphs and bullet points.`,
      },
    ],
  });
  const content = completion.choices[0]?.message?.content?.trim() ?? '';
  if (!content) throw new AppError('AI returned empty content', 502);
  const tokensUsed = completion.usage?.total_tokens ?? null;
  const subject = `${topic} - ${new Date().toLocaleDateString()}`;
  const htmlBody = `<div style="font-family: sans-serif; line-height: 1.5; color: #333;">${escapeHtmlFragment(content).replace(/\n\n/g, '<br/><br/>')}</div>`;
  return { subject, htmlBody, tokensUsed };
}
