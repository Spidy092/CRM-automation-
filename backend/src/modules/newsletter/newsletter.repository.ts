import { query, queryOne } from '../../shared/utils/db';
import { NEWSLETTER_TOPICS } from './newsletter.schema';
import { AppError } from '../../shared/middleware/errorHandler';
import { incNewsletterLegacyTokenHit } from '../../shared/utils/metrics';
import {
  NewsletterSubscriberRow,
  NewsletterSubscriberStatus,
  NewsletterFrequency,
} from './newsletter.types';

const SUBSCRIBER_COLS = `id, email, status, topics, frequency, unsubscribe_token_hash, source,
  confirmed_at, unsubscribed_at, created_at, updated_at`;

function parseTopics(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRow(row: NewsletterSubscriberRow & { topics: unknown }): NewsletterSubscriberRow {
  return { ...row, topics: parseTopics(row.topics) };
}

export async function findSubscriberByEmail(
  email: string,
): Promise<NewsletterSubscriberRow | null> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE lower(email) = lower($1)`,
    [email],
  );
  return row ? mapRow(row) : null;
}

export async function findSubscriberById(id: string): Promise<NewsletterSubscriberRow | null> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function findSubscriberByUnsubscribeTokenHash(
  tokenHash: string,
): Promise<NewsletterSubscriberRow | null> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers WHERE unsubscribe_token_hash = $1`,
    [tokenHash],
  );
  return row ? mapRow(row) : null;
}

/**
 * True when a Postgres error means "table does not exist" (SQLSTATE 42P01).
 * Used to degrade gracefully when append-only migrations 0081/0079+0082 are
 * written but not yet approved/run: token-table and broadcast-table access
 * falls back to the single-hash column and Redis outcomes respectively.
 */
export function isMissingRelationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === '42P01') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /relation .* does not exist/i.test(message);
}

/**
 * Dual lookup for unsubscribe/preference tokens.
 *
 * Resolution order (first hit wins):
 *   1. Multi-token table (`newsletter_subscriber_tokens`, migration 0081):
 *      hash(supplied raw token) matches a non-revoked row. Every broadcast
 *      appends a row and never revokes, so links from ALL past legitimate
 *      emails keep working.
 *   2. Current single-column hash: hash(supplied) equals
 *      `newsletter_subscribers.unsubscribe_token_hash` (pre-0081 rows and
 *      degraded-mode sends).
 *   3. Legacy direct-hash fallback: supplied value equals the stored hash
 *      verbatim. This accepts a stored hash as a bearer credential, which is
 *      reviewed explicitly below. It exists only for emails sent before any
 *      raw-token scheme (the original worker embedded the stored hash
 *      directly in URLs, so those links carry a hash, not a raw token).
 *
 * Explicit security review of step 3 (do not remove without reading this):
 * - Entropy: the value is 64 hex chars from 256-bit CSPRNG output —
 *   unguessable; acceptance grants only single-subscriber
 *   unsubscribe/preference scope (the preferences endpoint returns topics,
 *   frequency, and status — no PII beyond what the email already contains).
 * - Exposure equivalence: the value was already distributed AS a bearer
 *   credential inside those emails. Accepting it confers nothing beyond
 *   what possession of the email already conferred. Server access logs that
 *   capture query strings expose raw tokens and legacy hashes identically.
 * - Residual difference vs raw tokens: the hash is additionally present at
 *   rest (DB + backups), but database access already implies full
 *   subscriber access, so there is no privilege gain.
 *
 * Compatibility and revocation policy (step 3 is permanent until ALL hold):
 * - Compatibility: legacy direct-hash links and single-column-hash links
 *   resolve INDEFINITELY. There is no expiry, no hit-count threshold, and
 *   no automatic revocation — old emails live in inboxes indefinitely, so
 *   "zero recent fallback hits" proves nothing about stored-but-unclicked
 *   links and can NEVER alone justify removal.
 * - Revocation happens ONLY through explicit admin action (setting
 *   `revoked_at` on token-table rows, or a future admin revocation API).
 *   No send, resubscribe, or rotation path revokes anything implicitly.
 * - Removal bar: migration 0081 live in production AND product + security
 *   sign-off with an announced grace period AND ~90 days of near-zero
 *   `crm_newsletter_legacy_token_hits_total` telemetry. Telemetry informs
 *   the decision; it does not make it.
 *
 * Callers must never log the supplied token or any stored hash.
 */
export async function findSubscriberByUnsubscribeToken(
  suppliedToken: string,
  hashFn: (token: string) => string,
): Promise<NewsletterSubscriberRow | null> {
  const hashed = hashFn(suppliedToken);
  try {
    const byTable = await findSubscriberByTokenTableHash(hashed);
    if (byTable) return byTable;
  } catch (err) {
    if (!isMissingRelationError(err)) throw err;
    // Migration 0081 not yet run: fall through to single-column behaviour.
  }
  const byHash = await findSubscriberByUnsubscribeTokenHash(hashed);
  if (byHash) return byHash;
  // Legacy links embed the stored hash directly. Accept them without
  // re-hashing so existing subscribers are not locked out.
  if (suppliedToken !== hashed) {
    const legacy = await findSubscriberByUnsubscribeTokenHash(suppliedToken);
    if (legacy) incNewsletterLegacyTokenHit();
    return legacy;
  }
  return null;
}

/**
 * Probe for migration 0081 without side effects. Send paths call this
 * BEFORE any dispatch: when the token table is absent, sends are gated
 * with an actionable setup error (fail closed) instead of rotating the
 * single stored hash and invalidating older links.
 */
export async function isTokenTableAvailable(): Promise<boolean> {
  try {
    await queryOne<{ one: number }>(`SELECT 1 AS one FROM newsletter_subscriber_tokens LIMIT 1`);
    return true;
  } catch (err) {
    if (isMissingRelationError(err)) return false;
    throw err;
  }
}

/** Probe the rolling-send-limit columns added by migration 0084 before enqueue. */
export async function isSendLimitStorageAvailable(): Promise<boolean> {
  try {
    await query(
      `SELECT newsletter_last_accepted_at, newsletter_reserved_until,
        newsletter_reservation_key FROM newsletter_subscribers LIMIT 0`,
    );
    return true;
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return false;
    throw err;
  }
}

/**
 * Append a token-table row for one broadcast send. Never updates or revokes
 * existing rows: older links stay valid. Throws through missing-table
 * errors so the caller can degrade explicitly.
 */
export async function createSubscriberToken(
  subscriberId: string,
  tokenHash: string,
  label?: string,
): Promise<void> {
  await query(
    `INSERT INTO newsletter_subscriber_tokens (subscriber_id, token_hash, label)
     VALUES ($1, $2, $3)`,
    [subscriberId, tokenHash, label ?? null],
  );
}

export async function findSubscriberByTokenTableHash(
  tokenHash: string,
): Promise<NewsletterSubscriberRow | null> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers s
     WHERE s.id = (
       SELECT t.subscriber_id FROM newsletter_subscriber_tokens t
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL
       LIMIT 1
     )`,
    [tokenHash],
  );
  return row ? mapRow(row) : null;
}

export async function updateUnsubscribeTokenHash(id: string, tokenHash: string): Promise<void> {
  await query(
    `UPDATE newsletter_subscribers SET unsubscribe_token_hash = $2, updated_at = now() WHERE id = $1`,
    [id, tokenHash],
  );
}

export interface SubscriberFilters {
  status?: NewsletterSubscriberStatus;
  search?: string;
  topic?: string;
  source?: string;
  frequency?: NewsletterFrequency;
}

function buildSubscriberFilterWhere(
  filters: SubscriberFilters,
  startIndex = 1,
): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;
  if (filters.status) {
    clauses.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.search) {
    clauses.push(`email ILIKE $${i++}`);
    params.push(`%${filters.search}%`);
  }
  if (filters.topic) {
    clauses.push(`topics @> $${i++}::jsonb`);
    params.push(JSON.stringify([filters.topic]));
  }
  if (filters.source) {
    clauses.push(`source = $${i++}`);
    params.push(filters.source);
  }
  if (filters.frequency) {
    clauses.push(`frequency = $${i++}`);
    params.push(filters.frequency);
  }
  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function insertSubscriber(data: {
  email: string;
  topics: string[];
  frequency: NewsletterFrequency;
  unsubscribeTokenHash: string;
  source: string | null;
}): Promise<NewsletterSubscriberRow> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `INSERT INTO newsletter_subscribers (email, status, topics, frequency, unsubscribe_token_hash, source)
     VALUES ($1, 'pending', $2::jsonb, $3, $4, $5)
     RETURNING ${SUBSCRIBER_COLS}`,
    [
      data.email,
      JSON.stringify(data.topics),
      data.frequency,
      data.unsubscribeTokenHash,
      data.source,
    ],
  );
  if (!row) throw new AppError('Failed to create subscriber', 500);
  return mapRow(row);
}

export async function resetToPending(
  id: string,
  topics: string[],
  frequency: NewsletterFrequency,
): Promise<NewsletterSubscriberRow> {
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `UPDATE newsletter_subscribers
     SET status = 'pending', topics = $2::jsonb, frequency = $3,
         confirmed_at = NULL, unsubscribed_at = NULL, updated_at = now()
     WHERE id = $1
     RETURNING ${SUBSCRIBER_COLS}`,
    [id, JSON.stringify(topics), frequency],
  );
  if (!row) throw new AppError('Subscriber not found', 404);
  return mapRow(row);
}

export async function markConfirmed(id: string): Promise<void> {
  await query(
    `UPDATE newsletter_subscribers
     SET status = 'confirmed', topics = $2::jsonb, confirmed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [id, JSON.stringify(NEWSLETTER_TOPICS)],
  );
}

export async function markUnsubscribed(id: string): Promise<void> {
  await query(
    `UPDATE newsletter_subscribers
     SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id],
  );
}

export async function updatePreferences(
  id: string,
  fields: Partial<{ topics: string[]; frequency: NewsletterFrequency }>,
): Promise<NewsletterSubscriberRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.topics !== undefined) {
    sets.push(`topics = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.topics));
  }
  if (fields.frequency !== undefined) {
    sets.push(`frequency = $${i++}`);
    params.push(fields.frequency);
  }
  sets.push('updated_at = now()');

  params.push(id);
  const row = await queryOne<NewsletterSubscriberRow & { topics: unknown }>(
    `UPDATE newsletter_subscribers SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SUBSCRIBER_COLS}`,
    params,
  );
  if (!row) throw new AppError('Subscriber not found', 404);
  return mapRow(row);
}

export async function findSubscribers(
  limit: number,
  offset: number,
  status?: NewsletterSubscriberStatus,
  filters?: Omit<SubscriberFilters, 'status'>,
): Promise<NewsletterSubscriberRow[]> {
  const merged: SubscriberFilters = { ...(filters ?? {}), ...(status ? { status } : {}) };
  const { clause, params } = buildSubscriberFilterWhere(merged);
  // Params for LIMIT/OFFSET follow filter params to keep indexes stable.
  const rows = await query<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers
     ${clause} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows.map(mapRow);
}

export async function countSubscribers(
  status?: NewsletterSubscriberStatus,
  filters?: Omit<SubscriberFilters, 'status'>,
): Promise<number> {
  const merged: SubscriberFilters = { ...(filters ?? {}), ...(status ? { status } : {}) };
  const { clause, params } = buildSubscriberFilterWhere(merged);
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM newsletter_subscribers ${clause}`,
    params,
  );
  return parseInt(row?.total ?? '0', 10);
}

/** Audience-wide counts independent of the current list filters/page. */
export async function countSubscribersByStatus(): Promise<
  Record<NewsletterSubscriberStatus, number> & { total: number }
> {
  const rows = await query<{ status: NewsletterSubscriberStatus; total: string }>(
    `SELECT status, COUNT(*) as total FROM newsletter_subscribers GROUP BY status`,
  );
  const out: Record<NewsletterSubscriberStatus, number> & { total: number } = {
    pending: 0,
    confirmed: 0,
    unsubscribed: 0,
    total: 0,
  };
  for (const r of rows) {
    const n = parseInt(r.total ?? '0', 10);
    if (r.status === 'pending' || r.status === 'confirmed' || r.status === 'unsubscribed') {
      out[r.status] = n;
    }
    out.total += n;
  }
  return out;
}

/**
 * Eligible recipients for a send: confirmed only, with optional topic /
 * frequency targeting. Pending, unsubscribed, and suppressed rows are never
 * returned. Callers must recheck `status` immediately before dispatch because
 * a subscriber may opt out between pagination and send.
 */
export interface EligibleTargeting {
  topics?: string[];
  /** Single frequency or a list (e.g. automated digests target daily + weekly). */
  frequency?: NewsletterFrequency | NewsletterFrequency[];
}

function pushFrequencyClause(
  clauses: string[],
  params: unknown[],
  frequency: NewsletterFrequency | NewsletterFrequency[] | undefined,
): void {
  if (!frequency) return;
  if (Array.isArray(frequency)) {
    if (frequency.length === 0) {
      // Empty list matches nothing — never fall through to unfiltered.
      clauses.push('FALSE');
      return;
    }
    params.push(frequency);
    clauses.push(`frequency = ANY($${params.length})`);
    return;
  }
  params.push(frequency);
  clauses.push(`frequency = $${params.length}`);
}

export async function findEligibleSubscribers(
  limit: number,
  afterOrOffset: number | string | null,
  targeting?: EligibleTargeting,
): Promise<NewsletterSubscriberRow[]> {
  const params: unknown[] = [];
  const clauses = [`status = 'confirmed'`];
  pushFrequencyClause(clauses, params, targeting?.frequency);
  if (targeting?.topics && targeting.topics.length > 0) {
    // Subscriber is eligible when they opted into at least one targeted topic.
    // `?|` on a jsonb array checks membership against a text[] — parameterized.
    params.push(targeting.topics);
    clauses.push(`topics ?| $${params.length}::text[]`);
  }
  // Workers page on immutable UUIDs so opt-outs in earlier pages cannot
  // shift later recipients. Numeric offsets remain for existing list callers.
  const keyset = typeof afterOrOffset !== 'number';
  if (typeof afterOrOffset === 'string') {
    params.push(afterOrOffset);
    clauses.push(`id < $${params.length}::uuid`);
  }
  params.push(limit);
  const limitIndex = params.length;
  if (!keyset) params.push(afterOrOffset);
  const rows = await query<NewsletterSubscriberRow & { topics: unknown }>(
    `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers
     WHERE ${clauses.join(' AND ')} ORDER BY ${keyset ? 'id DESC' : 'created_at DESC, id DESC'} LIMIT $${limitIndex}${keyset ? '' : ` OFFSET $${params.length}`}`,
    params,
  );
  return rows.map(mapRow);
}

export async function countEligibleSubscribers(targeting?: EligibleTargeting): Promise<number> {
  const params: unknown[] = [];
  const clauses = [`status = 'confirmed'`, SENDABLE_NOW_SQL];
  pushFrequencyClause(clauses, params, targeting?.frequency);
  if (targeting?.topics && targeting.topics.length > 0) {
    params.push(targeting.topics);
    clauses.push(`topics ?| $${params.length}::text[]`);
  }
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM newsletter_subscribers WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return parseInt(row?.total ?? '0', 10);
}

// ── Durable broadcast persistence (migrations 0079 + 0082, both pending) ────
// Every function below throws through missing-table errors (42P01); service
// callers catch via isMissingRelationError and degrade to Redis outcomes.
// Partial-application (0079 without 0082) is handled per function: 0082-only
// columns are written best-effort and 42703 (undefined column) is swallowed
// there — never silently for core lifecycle transitions.

export type NewsletterBroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'partially_failed'
  | 'failed';

export interface NewsletterBroadcastRow {
  id: string;
  subject: string;
  preview_text: string | null;
  topics: string[];
  frequency: NewsletterFrequency | null;
  timezone: string;
  scheduled_at: string | null;
  status: NewsletterBroadcastStatus;
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  html_body?: string | null;
  idempotency_key?: string | null;
  job_id?: string | null;
}

export interface NewsletterRecipientOutcome {
  broadcast_id: string;
  subscriber_id: string;
  status: 'accepted' | 'failed' | 'skipped' | 'uncertain';
  channel: string | null;
  error: string | null;
}

const BROADCAST_COLS = `id, subject, preview_text, topics, frequency, timezone,
  scheduled_at, status, attempted, accepted, failed, skipped, created_by,
  created_at, updated_at`;

function mapBroadcastRow(
  row: Omit<NewsletterBroadcastRow, 'topics'> & { topics: unknown },
): NewsletterBroadcastRow {
  return { ...row, topics: parseTopics(row.topics) };
}

function isUndefinedColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === '42703') return true;
  return /column .* does not exist/i.test(err instanceof Error ? err.message : String(err));
}

export async function createBroadcast(input: {
  subject: string;
  previewText?: string;
  topics?: string[];
  frequency?: NewsletterFrequency;
  frequencies?: NewsletterFrequency[];
  timezone?: string;
  scheduledAtUtc?: string;
  createdBy?: string;
  idempotencyKey?: string;
  status?: NewsletterBroadcastStatus;
}): Promise<NewsletterBroadcastRow> {
  const row = await queryOne<Omit<NewsletterBroadcastRow, 'topics'> & { topics: unknown }>(
    `INSERT INTO newsletter_broadcasts
       (subject, preview_text, topics, frequency, timezone, scheduled_at, status, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
     RETURNING ${BROADCAST_COLS}`,
    [
      input.subject,
      input.previewText ?? null,
      JSON.stringify(input.topics ?? []),
      input.frequency ?? null,
      input.timezone ?? 'UTC',
      input.scheduledAtUtc ?? null,
      input.status ?? 'scheduled',
      input.createdBy ?? null,
    ],
  );
  if (!row) throw new AppError('Failed to create broadcast', 500);
  // 0082 columns (content + idempotency + job mapping) are best-effort so a
  // 0079-only database still records lifecycle; the job payload and Redis
  // outcome retain the same data.
  if (input.idempotencyKey) {
    await setBroadcastIdempotencyKey(row.id, input.idempotencyKey).catch((err: unknown) => {
      if (!isUndefinedColumnError(err) && !isMissingRelationError(err)) throw err;
    });
  }
  // 0083 column (frequency-list audience), same best-effort treatment.
  if (input.frequencies) {
    await setBroadcastFrequencies(row.id, input.frequencies).catch((err: unknown) => {
      if (!isUndefinedColumnError(err) && !isMissingRelationError(err)) throw err;
    });
  }
  return mapBroadcastRow(row);
}

/** Audience frequency list (migration 0083). Best-effort on partial DBs. */
export async function setBroadcastFrequencies(
  id: string,
  frequencies: NewsletterFrequency[],
): Promise<void> {
  try {
    await query(`UPDATE newsletter_broadcasts SET frequencies = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify(frequencies),
    ]);
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return;
    throw err;
  }
}

/**
 * Frequency lists for a page of broadcasts in ONE indexed query (primary
 * key lookups), mirroring the uncertain-ids pattern. Missing column (0083
 * not applied) yields `{}` — callers treat absent as "no list filter".
 */
export async function findBroadcastFrequencies(
  broadcastIds: string[],
): Promise<Record<string, NewsletterFrequency[]>> {
  if (broadcastIds.length === 0) return {};
  try {
    const rows = await query<{ id: string; frequencies: unknown }>(
      `SELECT id, frequencies FROM newsletter_broadcasts WHERE id = ANY($1)`,
      [broadcastIds],
    );
    const out: Record<string, NewsletterFrequency[]> = {};
    for (const r of rows) {
      const list = Array.isArray(r.frequencies) ? r.frequencies : parseTopics(r.frequencies);
      out[r.id] = (list as unknown[]).filter(
        (v): v is NewsletterFrequency => v === 'daily' || v === 'weekly' || v === 'monthly',
      );
    }
    return out;
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return {};
    throw err;
  }
}

/** Idempotent lookup for double-submit protection (0082 unique index). */
export async function findBroadcastByIdempotencyKey(
  key: string,
): Promise<NewsletterBroadcastRow | null> {
  const row = await queryOne<Omit<NewsletterBroadcastRow, 'topics'> & { topics: unknown }>(
    `SELECT ${BROADCAST_COLS} FROM newsletter_broadcasts WHERE idempotency_key = $1`,
    [key],
  ).catch((err: unknown) => {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return null;
    throw err;
  });
  return row ? mapBroadcastRow(row) : null;
}

export async function findBroadcastById(id: string): Promise<NewsletterBroadcastRow | null> {
  const row = await queryOne<Omit<NewsletterBroadcastRow, 'topics'> & { topics: unknown }>(
    `SELECT ${BROADCAST_COLS} FROM newsletter_broadcasts WHERE id = $1`,
    [id],
  );
  return row ? mapBroadcastRow(row) : null;
}

/** Broadcast row plus the persisted count of `uncertain` recipients. */
export interface NewsletterBroadcastHistoryRow extends NewsletterBroadcastRow {
  uncertain: number;
}

type BroadcastHistoryQueryRow = Omit<NewsletterBroadcastRow, 'topics'> & {
  topics: unknown;
  uncertain_count: string | number | null;
};

function mapHistoryRow(row: BroadcastHistoryQueryRow): NewsletterBroadcastHistoryRow {
  const { uncertain_count, ...rest } = row;
  return {
    ...mapBroadcastRow(rest),
    uncertain:
      typeof uncertain_count === 'number' ? uncertain_count : parseInt(uncertain_count ?? '0', 10),
  };
}

/**
 * Uncertain aggregates are derived per-recipient (`status = 'uncertain'`)
 * rather than stored on the broadcast row, so no further schema change is
 * needed. The recipients table ships with migration 0079 itself, so this
 * subquery is valid on any database where the broadcasts table exists.
 */
const UNCERTAIN_COUNT_SELECT = `(SELECT COUNT(*) FROM newsletter_broadcast_recipients r
   WHERE r.broadcast_id = newsletter_broadcasts.id AND r.status = 'uncertain') AS uncertain_count`;

export async function findBroadcastHistoryById(
  id: string,
): Promise<NewsletterBroadcastHistoryRow | null> {
  const row = await queryOne<BroadcastHistoryQueryRow>(
    `SELECT ${BROADCAST_COLS}, ${UNCERTAIN_COUNT_SELECT}
     FROM newsletter_broadcasts WHERE id = $1`,
    [id],
  );
  return row ? mapHistoryRow(row) : null;
}

export async function setBroadcastContent(
  id: string,
  content: { htmlBody?: string; jobId?: string; subject?: string; previewText?: string },
): Promise<void> {
  // Core columns (subject/preview_text, migration 0079) update directly —
  // the table exists whenever this is called with a real row id.
  if (content.subject !== undefined || content.previewText !== undefined) {
    await query(
      `UPDATE newsletter_broadcasts SET subject = COALESCE($2, subject),
        preview_text = COALESCE($3, preview_text), updated_at = now() WHERE id = $1`,
      [id, content.subject ?? null, content.previewText ?? null],
    );
  }
  try {
    await query(
      `UPDATE newsletter_broadcasts SET html_body = COALESCE($2, html_body),
        job_id = COALESCE($3, job_id), updated_at = now() WHERE id = $1`,
      [id, content.htmlBody ?? null, content.jobId ?? null],
    );
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return;
    throw err;
  }
}

/**
 * Original send content for the requeue content-lock. Null when the 0082
 * columns are absent — callers must then refuse to guess (fail closed).
 */
export async function findBroadcastContent(
  id: string,
): Promise<{ htmlBody: string | null } | null> {
  try {
    const row = await queryOne<{ html_body: string | null }>(
      `SELECT html_body FROM newsletter_broadcasts WHERE id = $1`,
      [id],
    );
    return row ? { htmlBody: row.html_body } : null;
  } catch (err) {
    if (isUndefinedColumnError(err) || isMissingRelationError(err)) return null;
    throw err;
  }
}

/** True once any recipient outcome exists — i.e. something may have sent. */
export async function hasRecipientOutcomes(broadcastId: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM newsletter_broadcast_recipients WHERE broadcast_id = $1) AS exists`,
    [broadcastId],
  );
  return row?.exists ?? false;
}

export async function setBroadcastIdempotencyKey(id: string, key: string): Promise<void> {
  await query(`UPDATE newsletter_broadcasts SET idempotency_key = $2 WHERE id = $1`, [id, key]);
}

export async function updateBroadcastStatus(
  id: string,
  status: NewsletterBroadcastStatus,
  counts?: { attempted: number; accepted: number; failed: number; skipped: number },
): Promise<void> {
  await query(
    `UPDATE newsletter_broadcasts
     SET status = $2, attempted = $3, accepted = $4, failed = $5, skipped = $6, updated_at = now()
     WHERE id = $1`,
    [
      id,
      status,
      counts?.attempted ?? 0,
      counts?.accepted ?? 0,
      counts?.failed ?? 0,
      counts?.skipped ?? 0,
    ],
  );
}

export async function listBroadcasts(
  limit: number,
  offset: number,
): Promise<NewsletterBroadcastRow[]> {
  const rows = await query<Omit<NewsletterBroadcastRow, 'topics'> & { topics: unknown }>(
    `SELECT ${BROADCAST_COLS} FROM newsletter_broadcasts
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(mapBroadcastRow);
}

export async function listBroadcastHistoryRows(
  limit: number,
  offset: number,
): Promise<NewsletterBroadcastHistoryRow[]> {
  const rows = await query<BroadcastHistoryQueryRow>(
    `SELECT ${BROADCAST_COLS}, ${UNCERTAIN_COUNT_SELECT}
     FROM newsletter_broadcasts
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(mapHistoryRow);
}

/**
 * Idempotent per-recipient outcome (0082 unique constraint). Under worker
 * concurrency or job retry, re-recording the same outcome is a no-op update,
 * never a duplicate row. On a 0079-only database (no constraint), falls back
 * to a plain insert — duplicates are then possible and documented.
 */
export async function upsertRecipientOutcome(outcome: NewsletterRecipientOutcome): Promise<void> {
  try {
    await query(
      `INSERT INTO newsletter_broadcast_recipients (broadcast_id, subscriber_id, status, channel, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (broadcast_id, subscriber_id)
       DO UPDATE SET status = EXCLUDED.status, channel = EXCLUDED.channel,
         error = EXCLUDED.error`,
      [outcome.broadcast_id, outcome.subscriber_id, outcome.status, outcome.channel, outcome.error],
    );
  } catch (err) {
    if (isMissingRelationError(err)) throw err;
    if (err instanceof Error && /no unique|no constraint|there is no unique/i.test(err.message)) {
      await query(
        `INSERT INTO newsletter_broadcast_recipients (broadcast_id, subscriber_id, status, channel, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          outcome.broadcast_id,
          outcome.subscriber_id,
          outcome.status,
          outcome.channel,
          outcome.error,
        ],
      );
      return;
    }
    throw err;
  }
}

export async function listFailedRecipientIds(broadcastId: string): Promise<string[]> {
  const rows = await query<{ subscriber_id: string }>(
    `SELECT subscriber_id FROM newsletter_broadcast_recipients
     WHERE broadcast_id = $1 AND status = 'failed'`,
    [broadcastId],
  );
  return rows.map((r) => r.subscriber_id);
}

/**
 * Recipients whose send outcome is UNKNOWN (claim orphaned by a crash
 * between claim and receipt). Never auto-resent: operators review this
 * list and opt in explicitly via retry with `includeUncertain`.
 */
export async function listUncertainRecipientIds(broadcastId: string): Promise<string[]> {
  const rows = await query<{ subscriber_id: string }>(
    `SELECT subscriber_id FROM newsletter_broadcast_recipients
     WHERE broadcast_id = $1 AND status = 'uncertain'`,
    [broadcastId],
  );
  return rows.map((r) => r.subscriber_id);
}

/**
 * Uncertain ids for a page of broadcasts in ONE indexed query, so history
 * items can carry actionable ids without N+1 lookups.
 */
export async function listUncertainRecipientIdsForBroadcasts(
  broadcastIds: string[],
): Promise<Record<string, string[]>> {
  if (broadcastIds.length === 0) return {};
  const rows = await query<{ broadcast_id: string; subscriber_id: string }>(
    `SELECT broadcast_id, subscriber_id FROM newsletter_broadcast_recipients
     WHERE broadcast_id = ANY($1) AND status = 'uncertain'
     LIMIT 500`,
    [broadcastIds],
  );
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    (grouped[r.broadcast_id] ??= []).push(r.subscriber_id);
  }
  return grouped;
}

/** Atomic enrollment: existing confirmations and opt-outs are never overwritten. */
export async function addConfirmedContact(data: {
  email: string;
  topics: string[];
  frequency: NewsletterFrequency;
  unsubscribeTokenHash: string;
}): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO newsletter_subscribers
       (email, status, topics, frequency, unsubscribe_token_hash, source, confirmed_at)
     VALUES ($1, 'confirmed', $2::jsonb, $3, $4, 'lead_import', now())
     ON CONFLICT (lower(email)) DO UPDATE
       SET status = 'confirmed', topics = EXCLUDED.topics, frequency = EXCLUDED.frequency,
           source = 'lead_import', confirmed_at = now(), updated_at = now()
       WHERE newsletter_subscribers.status = 'pending'
     RETURNING id`,
    [data.email, JSON.stringify(data.topics), data.frequency, data.unsubscribeTokenHash],
  );
  return row !== null;
}

/** Fixed elapsed hours, independent of calendar boundaries and timezone/DST. */
const ROLLING_LIMIT_SQL = `CASE frequency
  WHEN 'daily' THEN interval '24 hours'
  WHEN 'weekly' THEN interval '168 hours'
  ELSE interval '720 hours' END`;
const SENDABLE_NOW_SQL = `(newsletter_reserved_until IS NULL OR newsletter_reserved_until <= now())
  AND (newsletter_last_accepted_at IS NULL OR newsletter_last_accepted_at <= now() - (${ROLLING_LIMIT_SQL}))`;

/** Atomic cross-broadcast reservation, held conservatively on unknown outcomes. */
export async function reserveNewsletterSend(
  subscriberId: string,
  key: string,
  allowUncertainRetryFrom?: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE newsletter_subscribers SET newsletter_reservation_key = $2,
      newsletter_reserved_until = now() + interval '720 hours'
     WHERE id = $1 AND status = 'confirmed'
       AND (newsletter_last_accepted_at IS NULL OR newsletter_last_accepted_at <= now() - (${ROLLING_LIMIT_SQL}))
       AND (
         newsletter_reserved_until IS NULL OR newsletter_reserved_until <= now()
         OR ($3::text IS NOT NULL AND newsletter_reservation_key = $3 AND newsletter_reserved_until > now())
       )
     RETURNING id`,
    [subscriberId, key, allowUncertainRetryFrom ?? null],
  );
  return row !== null;
}
export async function finishNewsletterSend(
  subscriberId: string,
  key: string,
  accepted: boolean,
): Promise<void> {
  await query(
    `UPDATE newsletter_subscribers
    SET newsletter_last_accepted_at = CASE WHEN $3 THEN now() ELSE newsletter_last_accepted_at END,
      newsletter_reservation_key = NULL, newsletter_reserved_until = NULL
    WHERE id = $1 AND newsletter_reservation_key = $2`,
    [subscriberId, key, accepted],
  );
}
