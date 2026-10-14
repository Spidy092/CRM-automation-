import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { NEWSLETTER_QUEUE, getBullConnection, type NewsletterBroadcastJob } from './queue';
import { logger } from '../shared/utils/logger';
import { redis } from '../shared/utils/redis';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import {
  findEligibleSubscribers,
  findSubscriberById,
  updateBroadcastStatus,
  upsertRecipientOutcome,
  isMissingRelationError,
} from '../modules/newsletter/newsletter.repository';
import {
  buildBroadcastHtml,
  mintBroadcastToken,
  recordDigestOutcome,
  saveDigestDraft,
  generateDigestContent,
  getDigestDraft,
  triggerBroadcast,
} from '../modules/newsletter/newsletter.service';
import { getAiConfig } from '../modules/ai-settings/ai-settings.service';
import type {
  NewsletterFrequency,
  NewsletterSubscriberRow,
} from '../modules/newsletter/newsletter.types';
import * as sendgrid from '../modules/integrations/sendgrid/sendgrid.connector';
import * as smtp from '../modules/integrations/smtp/smtp.connector';

const BROADCAST_OUTCOME_TTL_SECONDS = 30 * 24 * 60 * 60;

function claimKey(broadcastId: string, subscriberId: string): string {
  return `newsletter:broadcast:claim:${broadcastId}:${subscriberId}`;
}

function receiptKey(broadcastId: string, subscriberId: string): string {
  return `newsletter:broadcast:receipt:${broadcastId}:${subscriberId}`;
}

type ReceiptStatus = 'accepted' | 'failed' | 'uncertain';

function parseReceipt(raw: string | null): { status: ReceiptStatus; detail: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  const status = (idx < 0 ? raw : raw.slice(0, idx)) as ReceiptStatus;
  if (status !== 'accepted' && status !== 'failed' && status !== 'uncertain') return null;
  return { status, detail: idx < 0 ? '' : raw.slice(idx + 1) };
}

function formatReceipt(status: ReceiptStatus, detail = ''): string {
  return detail ? `${status}:${detail.slice(0, 200)}` : status;
}

/**
 * Atomic claim + receipt protocol for exactly-one-live-attempt semantics.
 *
 * Claims (`SET NX`) close the check-then-set race: at most one worker
 * attempt across concurrency and retries can hold a recipient's claim.
 * Receipts record the KNOWN terminal state immediately when it is known.
 * A held claim with NO receipt means the previous attempt died between
 * claim and receipt — the send outcome is UNKNOWN, never success.
 *
 * Fail-closed Redis handling (no fail-open sends): every claim/receipt
 * Redis error THROWS, failing the job into BullMQ retry with backoff.
 * Already-receipted recipients skip safely on retry, so throwing never
 * duplicates. Exactly-once delivery is impossible without provider-side
 * idempotency keys (neither SendGrid nor SMTP offers them); this protocol
 * delivers at-most-once per claim with explicit `uncertain` marking for
 * the residual crash window instead of silent loss or silent duplication.
 */
async function tryClaimRecipient(broadcastId: string, subscriberId: string): Promise<boolean> {
  try {
    const res = await redis.set(
      claimKey(broadcastId, subscriberId),
      '1',
      'EX',
      BROADCAST_OUTCOME_TTL_SECONDS,
      'NX',
    );
    return res === 'OK';
  } catch (err) {
    throw new Error(
      `Newsletter dedupe storage unavailable (Redis) — pausing job for retry; no recipient was sent without a claim: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function readReceipt(
  broadcastId: string,
  subscriberId: string,
): Promise<{ status: ReceiptStatus; detail: string } | null> {
  try {
    return parseReceipt(await redis.get(receiptKey(broadcastId, subscriberId)));
  } catch (err) {
    throw new Error(
      `Newsletter dedupe storage unavailable (Redis) — pausing job for retry: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function writeReceipt(
  broadcastId: string,
  subscriberId: string,
  status: ReceiptStatus,
  detail = '',
): Promise<void> {
  try {
    await redis.set(
      receiptKey(broadcastId, subscriberId),
      formatReceipt(status, detail),
      'EX',
      BROADCAST_OUTCOME_TTL_SECONDS,
    );
  } catch (err) {
    throw new Error(
      `Newsletter dedupe storage unavailable (Redis) — pausing job for retry: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function releaseClaim(broadcastId: string, subscriberId: string): Promise<void> {
  try {
    await redis.del(claimKey(broadcastId, subscriberId));
  } catch {
    // Best-effort: a held claim after an explicit failure only delays the
    // retry until TTL expiry; the retry endpoint mints a fresh broadcast id
    // with its own claim namespace, so recovery is unaffected.
  }
}

async function recordDbOutcome(
  broadcastRecordId: string | undefined,
  dbAvailable: boolean,
  outcome: {
    subscriberId: string;
    status: 'accepted' | 'failed' | 'skipped' | 'uncertain';
    channel?: string;
    error?: string;
  },
): Promise<void> {
  if (!broadcastRecordId || !dbAvailable) return;
  try {
    await upsertRecipientOutcome({
      broadcast_id: broadcastRecordId,
      subscriber_id: outcome.subscriberId,
      status: outcome.status,
      channel: outcome.channel ?? null,
      error: outcome.error ?? null,
    });
  } catch (err) {
    if (!isMissingRelationError(err)) {
      logger.warn('Failed to record newsletter recipient outcome', {
        subscriberId: outcome.subscriberId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function outcomeKey(broadcastId: string): string {
  return `newsletter:broadcast:outcome:${broadcastId}`;
}

/**
 * Full preference recheck immediately before dispatch. The initial
 * eligibility query (or a retry allow-list built from it) is a point-in-time
 * snapshot: a subscriber may change topics or frequency afterwards, and the
 * send must honour the CURRENT preferences, not the stale ones.
 *
 * Mirrors the repository targeting semantics exactly:
 * - no topic filter → topic check passes;
 * - otherwise the subscriber must still opt into at least one targeted topic
 *   (`topics ?|`, same as `findEligibleSubscribers`);
 * - no frequency filter → frequency check passes;
 * - single frequency → equality; list → membership.
 */
export function isStillEligible(
  subscriber: Pick<NewsletterSubscriberRow, 'topics' | 'frequency'>,
  targeting: { topics?: string[]; frequency?: NewsletterFrequency | NewsletterFrequency[] },
): boolean {
  if (targeting.topics && targeting.topics.length > 0) {
    const opted = new Set(subscriber.topics ?? []);
    if (!targeting.topics.some((t) => opted.has(t))) return false;
  }
  const freq = targeting.frequency;
  if (freq !== undefined) {
    if (
      Array.isArray(freq) ? !freq.includes(subscriber.frequency) : subscriber.frequency !== freq
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Send one recipient. Returns 'accepted' when a provider accepted the message
 * (SendGrid 2xx OR SMTP success), 'failed' otherwise. Provider acceptance is
 * NOT delivery — delivered/opened/clicked/bounced only come from provider
 * webhooks (see webhooks/webhook-handlers.ts handleSendGridEvents), which the
 * newsletter module has no dedicated ingestion for yet; history therefore
 * reports accepted/failed honestly and labels delivered metrics unavailable.
 */
async function sendToRecipient(input: {
  subscriberId: string;
  email: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ outcome: 'accepted' | 'failed'; channel?: string; error?: string }> {
  const emailInput = {
    leadId: input.subscriberId,
    to: input.email,
    subject: input.subject,
    htmlBody: input.html,
    textBody: input.text,
  };
  try {
    const sgRes = await sendgrid.sendEmail(emailInput);
    if (sgRes.ok) return { outcome: 'accepted', channel: 'sendgrid' };
    logger.warn('SendGrid did not accept newsletter email, trying SMTP fallback', {
      subscriberId: input.subscriberId,
      status: sgRes.status,
    });
  } catch (err) {
    logger.warn('SendGrid threw for newsletter email, trying SMTP fallback', {
      subscriberId: input.subscriberId,
      error: (err as Error).message,
    });
  }
  // Inspect the SMTP fallback Result — a rejected promise AND a
  // `{ ok: false }` payload both count as failure (previous code awaited the
  // promise and ignored the payload, reporting success unconditionally).
  try {
    const smtpRes = await smtp.sendEmail(emailInput);
    if (smtpRes.ok) return { outcome: 'accepted', channel: 'smtp' };
    return { outcome: 'failed', error: smtpRes.error };
  } catch (err) {
    return { outcome: 'failed', error: (err as Error).message };
  }
}

export async function processBroadcast(job: Job<NewsletterBroadcastJob>): Promise<{
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  uncertain: number;
}> {
  const {
    subject,
    htmlBody,
    previewText,
    topics,
    frequency,
    frequencies,
    timezone,
    broadcastRecordId,
    recipientIds,
    retryOf,
  } = job.data;
  const broadcastId = (job.id ?? `${Date.now()}`).toString();
  const broadcastLabel = (job.data.idempotencyKey ?? broadcastId).toString().slice(0, 128);
  const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  let offset = 0;
  const limit = 100;
  let attempted = 0;
  let accepted = 0;
  let failed = 0;
  let skipped = 0;
  let uncertain = 0;
  const failures: Array<{ subscriberId: string; error: string }> = [];
  const uncertainIds: string[] = [];

  // Durable lifecycle: scheduled -> processing now; terminal at the end.
  // Missing tables (migrations pending) leave dbAvailable false and the job
  // continues on the Redis-only path.
  let dbAvailable = false;
  if (broadcastRecordId) {
    try {
      await updateBroadcastStatus(broadcastRecordId, 'processing');
      dbAvailable = true;
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
  }

  /**
   * Targeted retry jobs carry an explicit allow-list: ONLY those recipients
   * are processed (consent rechecked below per recipient). Fresh failures
   * therefore never resend to already-successful recipients — not even via
   * BullMQ job retry, which is additionally guarded by atomic claims.
   */
  const targeted = Array.isArray(recipientIds) && recipientIds.length > 0;
  // `frequencies` (automated sends) takes precedence over the single
  // manual-broadcast `frequency` filter when both are present.
  const frequencyFilter = frequencies ?? frequency;
  let hasMore = true;

  while (hasMore) {
    let subscribers: Array<NonNullable<Awaited<ReturnType<typeof findSubscriberById>>>>;
    let pageExhausted = false;
    if (targeted) {
      const ids = recipientIds.slice(offset, offset + limit);
      pageExhausted = ids.length === 0;
      const rows = await Promise.all(ids.map((id) => findSubscriberById(id).catch(() => null)));
      // Allow-list ids with no row (deleted or never existed) count as
      // skipped with a durable outcome — never silently dropped.
      for (let k = 0; k < rows.length; k += 1) {
        if (rows[k] === null) {
          skipped += 1;
          await recordDbOutcome(broadcastRecordId, dbAvailable, {
            subscriberId: ids[k],
            status: 'skipped',
            error: 'subscriber not found at retry time',
          });
        }
      }
      subscribers = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    } else {
      subscribers = await findEligibleSubscribers(limit, offset, {
        ...(topics ? { topics } : {}),
        ...(frequencyFilter ? { frequency: frequencyFilter } : {}),
      });
      pageExhausted = subscribers.length === 0;
    }
    if (pageExhausted) {
      hasMore = false;
      continue;
    }

    for (const sub of subscribers) {
      // Recheck eligibility immediately before dispatch: the subscriber may
      // have unsubscribed (or been suppressed) between enqueue and send.
      // Pending / unsubscribed rows are always excluded, never retried.
      // This check runs on EVERY attempt, including targeted retries.
      const fresh = targeted ? sub : await findSubscriberById(sub.id).catch(() => null);
      if (!fresh || fresh.status !== 'confirmed') {
        skipped += 1;
        await recordDbOutcome(broadcastRecordId, dbAvailable, {
          subscriberId: sub.id,
          status: 'skipped',
        });
        continue;
      }
      // Full preference recheck against CURRENT topics/frequency: the
      // pagination snapshot (or a retry allow-list built from it) may be
      // stale if the subscriber changed preferences after selection.
      // Applies to targeted retries too — stale allow-lists never override
      // current preferences.
      if (
        !isStillEligible(fresh, {
          ...(topics ? { topics } : {}),
          ...(frequencyFilter ? { frequency: frequencyFilter } : {}),
        })
      ) {
        skipped += 1;
        await recordDbOutcome(broadcastRecordId, dbAvailable, {
          subscriberId: sub.id,
          status: 'skipped',
          error: 'preferences changed after audience selection',
        });
        continue;
      }
      // Claim first: at most one live attempt holds a recipient. A held
      // claim WITHOUT a receipt means a previous attempt died mid-send —
      // the outcome is UNKNOWN. Mark `uncertain`, persist it, and NEVER
      // auto-resend: operators review and opt in explicitly.
      // A held claim WITH an `accepted` receipt is a certain prior send:
      // skip without resending. A held claim with a `failed` receipt is a
      // stale claim whose release was lost: reclaim once and reprocess.
      if (!(await tryClaimRecipient(broadcastId, sub.id))) {
        const receipt = await readReceipt(broadcastId, sub.id);
        if (receipt?.status === 'accepted') {
          skipped += 1;
          continue;
        }
        if (receipt?.status === 'failed') {
          await releaseClaim(broadcastId, sub.id);
          if (!(await tryClaimRecipient(broadcastId, sub.id))) {
            uncertain += 1;
            uncertainIds.push(sub.id);
            await writeReceipt(broadcastId, sub.id, 'uncertain', 'claim contention');
            await recordDbOutcome(broadcastRecordId, dbAvailable, {
              subscriberId: sub.id,
              status: 'uncertain',
              error: 'claim contention',
            });
            continue;
          }
        } else {
          uncertain += 1;
          uncertainIds.push(sub.id);
          await writeReceipt(broadcastId, sub.id, 'uncertain', 'interrupted send');
          await recordDbOutcome(broadcastRecordId, dbAvailable, {
            subscriberId: sub.id,
            status: 'uncertain',
            error: 'interrupted send: claim held without a recorded outcome',
          });
          logger.warn('Newsletter recipient outcome unknown — marked uncertain, not resent', {
            subscriberId: sub.id,
            jobId: job.id,
          });
          continue;
        }
      }
      // Per-send token from the append-only table (migration 0081). Missing
      // table throws an actionable setup error here — before any send, with
      // no rotation and no invalidation of older links.
      const { raw: rawToken } = await mintBroadcastToken(sub.id, broadcastLabel);
      const prefsUrl = `${baseUrl}/newsletter/preferences?token=${encodeURIComponent(rawToken)}`;
      const unsubUrl = `${baseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(rawToken)}`;
      const { html, text } = buildBroadcastHtml(htmlBody, {
        ...(previewText ? { previewText } : {}),
        prefsUrl,
        unsubUrl,
      });

      attempted += 1;
      const result = await sendToRecipient({
        subscriberId: sub.id,
        email: sub.email,
        subject,
        html,
        text,
      });
      if (result.outcome === 'accepted') {
        accepted += 1;
        // Receipt FIRST-class: the known outcome is persisted immediately.
        // The claim stays held so retries skip this recipient (no duplicate).
        await writeReceipt(broadcastId, sub.id, 'accepted', result.channel ?? '');
        await recordDbOutcome(broadcastRecordId, dbAvailable, {
          subscriberId: sub.id,
          status: 'accepted',
          ...(result.channel ? { channel: result.channel } : {}),
        });
      } else {
        failed += 1;
        // Explicit failure releases the claim so a LATER targeted retry can
        // reprocess this recipient (BullMQ job-level retry additionally
        // re-enters the loop, where a released claim is reclaimable). The
        // failed receipt documents the known outcome for the next attempt.
        await writeReceipt(broadcastId, sub.id, 'failed', result.error ?? 'provider rejected');
        await releaseClaim(broadcastId, sub.id);
        failures.push({ subscriberId: sub.id, error: result.error ?? 'provider rejected' });
        await recordDbOutcome(broadcastRecordId, dbAvailable, {
          subscriberId: sub.id,
          status: 'failed',
          error: result.error ?? 'provider rejected',
        });
        logger.warn('Newsletter recipient failed (provider did not accept)', {
          subscriberId: sub.id,
          jobId: job.id,
        });
      }
    }

    offset += limit;
  }

  const status =
    uncertain > 0
      ? 'partially_failed'
      : failed === 0
        ? 'completed'
        : accepted > 0
          ? 'partially_failed'
          : 'failed';
  const outcome = {
    subject,
    topics: topics ?? [],
    frequency: frequency ?? null,
    ...(frequencies ? { frequencies } : {}),
    timezone: timezone ?? 'UTC',
    ...(retryOf ? { retryOf } : {}),
    attempted,
    accepted,
    failed,
    skipped,
    uncertain,
    uncertainIds: uncertainIds.slice(0, 50),
    failures: failures.slice(0, 50),
    status,
    finishedAt: new Date().toISOString(),
  };
  try {
    await redis.set(
      outcomeKey(broadcastId),
      JSON.stringify(outcome),
      'EX',
      BROADCAST_OUTCOME_TTL_SECONDS,
    );
  } catch (err) {
    // Reporting-only: dedupe safety lives in claims/receipts (fail-closed
    // above), and durability lives in the broadcast tables when present.
    // Still loud — an operator missing this outcome loses visibility.
    logger.error('Newsletter outcome record write failed', {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (broadcastRecordId && dbAvailable) {
    try {
      await updateBroadcastStatus(broadcastRecordId, status, {
        attempted,
        accepted,
        failed,
        skipped,
      });
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
    }
  }

  logger.info('Newsletter broadcast finished', {
    jobId: job.id,
    attempted,
    accepted,
    failed,
    skipped,
    uncertain,
  });
  if (uncertain > 0) {
    logger.warn(
      'Newsletter broadcast has uncertain sends — outcome unknown, NOT resent. Review via GET /admin/broadcasts/:id/uncertain-recipients and retry explicitly with includeUncertain.',
      { jobId: job.id, uncertain },
    );
  }

  // Surface failures instead of reporting misleading success:
  //  - total failure (nothing accepted) throws so BullMQ retries with backoff;
  //    receipts make the retry safe: accepted recipients skip, failed ones
  //    reclaim, uncertain ones stay uncertain (never auto-resent).
  //  - partial failure returns normally; the retry-failed endpoint (targeted
  //    allow-list) is the recovery path, never a wholesale resend.
  if (attempted > 0 && accepted === 0 && failed > 0) {
    throw new Error(`Newsletter broadcast failed: ${failed} recipient(s) rejected by providers`);
  }
  return { attempted, accepted, failed, skipped, uncertain };
}

async function processAutomatedDigest(job: Job): Promise<void> {
  logger.info('Starting automated newsletter digest generation', { jobId: job.id });

  let aiConfig: Awaited<ReturnType<typeof getAiConfig>> = null;
  try {
    aiConfig = await getAiConfig();
  } catch (err) {
    logger.warn('Failed to fetch AI settings for digest', { error: (err as Error).message });
  }

  const apiKey = aiConfig?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const message = 'OPENAI_API_KEY missing; cannot generate automated digest';
    logger.error(message);
    await recordDigestOutcome({ status: 'failed', message });
    return;
  }

  try {
    const start = Date.now();
    const generated = await generateDigestContent();
    const latencyMs = Date.now() - start;
    logger.info('Newsletter digest AI call complete', {
      jobId: job.id,
      tokensUsed: generated.tokensUsed,
      latencyMs,
    });

    // Reviewable by default: persist as a draft for human preview/edit/approve.
    await saveDigestDraft(
      { subject: generated.subject, htmlBody: generated.htmlBody },
      'Auto-generated — review before sending.',
    );

    const draftState = await getDigestDraft().catch(() => null);
    const autoSend = draftState?.ok && draftState.value.autoSend === true;

    if (!autoSend) {
      await recordDigestOutcome({
        status: 'needs_review',
        message: 'AI draft generated — awaiting human review before sending.',
      });
      logger.info('Automated digest saved as draft (auto-send off)', { jobId: job.id });
      return;
    }

    // Explicit auto-send: route through the same broadcast-creation
    // service as manual sends so the digest gets a durable broadcast row
    // (creator null = system), per-recipient DB outcomes, and the same
    // fail-closed setup gate. The weekly digest targets daily + weekly
    // frequencies (monthly subscribers opted out of weekly cadence); the
    // filter travels in the job payload so the worker enforces it.
    //
    // Idempotency identity: the BullMQ digest job id. Verified against the
    // installed BullMQ 5.79.0 implementation (repeat.js `getRepeatJobKey`
    // mixes the fire time into each weekly iteration's id since our
    // repeatable is registered without an explicit jobId; `retryJob`
    // re-queues failures under the SAME id). So retries of one execution
    // share the key (dedupe → no second broadcast) while separate weekly
    // executions get distinct keys. If the job id is ever absent, fall back
    // to keyless (previous behavior) rather than inventing an unstable key.
    const digestKey = typeof job.id === 'string' && job.id ? `digest-${job.id}` : undefined;
    if (!digestKey) {
      logger.warn('Digest job has no id; broadcasting without idempotency key', {
        jobName: job.name,
      });
    }
    const broadcast = await triggerBroadcast(generated.subject, generated.htmlBody, {
      subject: generated.subject,
      htmlBody: generated.htmlBody,
      frequencies: ['daily', 'weekly'],
      timezone: 'UTC',
      ...(digestKey ? { idempotencyKey: digestKey } : {}),
    });
    if (!broadcast.ok) throw broadcast.error;
    await recordDigestOutcome({
      status: 'success',
      message: `AI digest generated and broadcast ${broadcast.value.deduplicated ? 'already present' : 'enqueued'} (auto-send enabled, ${broadcast.value.eligible ?? 'unknown'} eligible).`,
    });
    logger.info('Automated newsletter digest generated and broadcast enqueued successfully', {
      broadcastId: broadcast.value.broadcastId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown digest error';
    logger.error('Failed to generate automated digest', { error: message });
    await recordDigestOutcome({ status: 'failed', message });
    throw err;
  }
}

export function startNewsletterWorker(): Worker {
  const worker = new Worker(
    NEWSLETTER_QUEUE,
    async (job: Job) => {
      const start = Date.now();
      logger.info(`Processing ${NEWSLETTER_QUEUE} job`, { jobName: job.name, jobId: job.id });

      try {
        if (job.name === 'newsletter:broadcast') {
          await processBroadcast(job as Job<NewsletterBroadcastJob>);
        } else if (job.name === 'newsletter:automated-digest') {
          await processAutomatedDigest(job);
        } else {
          logger.warn(`Unknown job name in ${NEWSLETTER_QUEUE}`, { jobName: job.name });
        }

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: NEWSLETTER_QUEUE }, durationSec);
        incJobsProcessed({ name: job.name, queue: NEWSLETTER_QUEUE, status: 'success' });
      } catch (err) {
        incJobsFailed({ name: job.name, queue: NEWSLETTER_QUEUE });
        logger.error(`Job ${job?.id} in ${NEWSLETTER_QUEUE} failed`, {
          jobName: job?.name,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    { connection: getBullConnection() as unknown as ConnectionOptions },
  );

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} in ${NEWSLETTER_QUEUE} failed`, {
      jobName: job?.name,
      error: err.message,
    });
    Sentry.captureException(err, { extra: { jobId: job?.id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(NEWSLETTER_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
  });

  return worker;
}
