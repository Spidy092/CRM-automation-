import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
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
     SET status = 'confirmed', confirmed_at = now(), updated_at = now()
     WHERE id = $1`,
    [id],
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
): Promise<NewsletterSubscriberRow[]> {
  const rows = status
    ? await query<NewsletterSubscriberRow & { topics: unknown }>(
        `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers
         WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [status, limit, offset],
      )
    : await query<NewsletterSubscriberRow & { topics: unknown }>(
        `SELECT ${SUBSCRIBER_COLS} FROM newsletter_subscribers
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
  return rows.map(mapRow);
}

export async function countSubscribers(status?: NewsletterSubscriberStatus): Promise<number> {
  const row = status
    ? await queryOne<{ total: string }>(
        `SELECT COUNT(*) as total FROM newsletter_subscribers WHERE status = $1`,
        [status],
      )
    : await queryOne<{ total: string }>(`SELECT COUNT(*) as total FROM newsletter_subscribers`);
  return parseInt(row?.total ?? '0', 10);
}
