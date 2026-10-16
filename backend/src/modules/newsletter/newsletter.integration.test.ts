/**
 * Real-PostgreSQL integration tests for newsletter persistence.
 *
 * GATED: this suite runs ONLY when TEST_DATABASE_URL points at an
 * authorized DISPOSABLE test database with the migration chain applied
 * (including 0079 + 0081 + 0082 — presented for approval, never run here).
 * Without it, the suite skips and mocked unit tests remain authoritative.
 *
 * Setup (after migration approval, disposable DB only):
 *   createdb crm_newsletter_it
 *   TEST_DATABASE_URL=postgres://.../crm_newsletter_it npm run migrate
 *   TEST_DATABASE_URL=postgres://.../crm_newsletter_it npx jest src/modules/newsletter/newsletter.integration.test.ts
 *
 * What this proves beyond mocks: migration constraints (unique token_hash,
 * recipient upsert idempotency incl. concurrent writers, idempotency_key
 * uniqueness, FKs + cascading deletes), multi-token resolution across two
 * real broadcast mints, revocation semantics, and uncertain aggregates.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const runIntegration = TEST_DATABASE_URL ? describe : describe.skip;

jest.mock(
  '../../shared/utils/db',
  () => {
    const { Pool: PgPool } = jest.requireActual('pg');
    const pool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL });
    return {
      pool,
      query: async (text: string, params?: unknown[]): Promise<Record<string, unknown>[]> => {
        const result = await pool.query(text, params);
        return result.rows as Record<string, unknown>[];
      },
      queryOne: async (text: string, params?: unknown[]): Promise<Record<string, unknown> | null> => {
        const result = await pool.query(text, params);
        return (result.rows[0] ?? null) as Record<string, unknown> | null;
      },
    };
  },
  { virtual: false },
);

import { pool } from '../../shared/utils/db';
import { hashToken } from './newsletter.service';
import {
  markConfirmed,
  getRecipientEligibility,
  addConfirmedContact,
  markUnsubscribed,
  insertSubscriber,
  findSubscriberByEmail,
  findSubscriberByUnsubscribeToken,
  createSubscriberToken,
  isTokenTableAvailable,
  reserveNewsletterSend,
  finishNewsletterSend,
  createBroadcast,
  findBroadcastHistoryById,
  listBroadcastHistoryRows,
  upsertRecipientOutcome,
  listFailedRecipientIds,
  listUncertainRecipientIds,
  listUncertainRecipientIdsForBroadcasts,
  updateBroadcastStatus,
} from './newsletter.repository';

jest.mock('../../shared/utils/metrics', () => ({
  incNewsletterLegacyTokenHit: jest.fn(),
}));

const email = (n: number | string) => `it-sub-${n}-${Date.now()}@example.com`;

runIntegration('newsletter persistence (real PostgreSQL)', () => {
  jest.setTimeout(30000);

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE newsletter_subscriber_tokens, newsletter_broadcast_recipients,
        newsletter_broadcasts, newsletter_subscribers RESTART IDENTITY CASCADE`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('confirms all public topics and enforces one rolling-window send across broadcasts', async () => {
    const sub = await insertSubscriber({
      email: email('frequency'), topics: [], frequency: 'daily',
      unsubscribeTokenHash: hashToken('seed-frequency'), source: 'website',
    });
    await markConfirmed(sub.id);
    expect((await findSubscriberByEmail(sub.email))?.topics).toEqual([
      'product_updates', 'promotions', 'company_news',
    ]);
    const reservations = await Promise.all([
      reserveNewsletterSend(sub.id, 'broadcast-A'),
      reserveNewsletterSend(sub.id, 'broadcast-B'),
    ]);
    expect(reservations.filter(Boolean)).toHaveLength(1);
    const key = reservations[0] ? 'broadcast-A' : 'broadcast-B';
    await finishNewsletterSend(sub.id, key, true);
    expect(await reserveNewsletterSend(sub.id, 'broadcast-C')).toBe(false);
  });

  it('partitions the audience into ready, pending, unsubscribed, topic mismatch, recent, and held', async () => {
    const rows = [];
    for (let index = 0; index < 6; index += 1) {
      const row = await insertSubscriber({ email: email(`breakdown-${index}`), topics: ['promotions'],
        frequency: 'weekly', unsubscribeTokenHash: hashToken(`breakdown-${index}`), source: 'website' });
      if (index !== 1) await markConfirmed(row.id);
      rows.push(row);
    }
    await markUnsubscribed(rows[2].id);
    await pool.query('UPDATE newsletter_subscribers SET topics = $2::jsonb WHERE id = $1', [rows[3].id, JSON.stringify(['company_news'])]);
    await pool.query("UPDATE newsletter_subscribers SET newsletter_last_accepted_at = now() - interval '1 day' WHERE id = $1", [rows[4].id]);
    await reserveNewsletterSend(rows[5].id, 'held-broadcast');
    const summary = await getRecipientEligibility({ topics: ['promotions'] });
    expect(summary).toMatchObject({ total: 6, eligible: 1, pending: 1, unsubscribed: 1,
      topicMismatch: 1, frequencyMismatch: 0, waiting: 1, reserved: 1 });
    expect(new Date(summary.nextEligibleAt!).getTime()).toBeGreaterThan(Date.now());
    expect((await getRecipientEligibility()).eligible).toBe(2);
    expect(await getRecipientEligibility({ frequency: 'daily' })).toMatchObject({ eligible: 0, frequencyMismatch: 4 });
  });

  it('resolves links from two successive broadcasts without invalidation', async () => {
    const sub = await insertSubscriber({
      email: email('a'),
      topics: ['promotions'],
      frequency: 'weekly',
      unsubscribeTokenHash: hashToken('seed'),
      source: 'test',
    });
    const rawA = `raw-a-${Date.now()}`;
    const rawB = `raw-b-${Date.now()}`;
    await createSubscriberToken(sub.id, hashToken(rawA), 'broadcast-A');
    await createSubscriberToken(sub.id, hashToken(rawB), 'broadcast-B');

    expect((await findSubscriberByUnsubscribeToken(rawA, hashToken))?.id).toBe(sub.id);
    expect((await findSubscriberByUnsubscribeToken(rawB, hashToken))?.id).toBe(sub.id);
    // The second mint did not invalidate the first send's link.
    expect((await findSubscriberByEmail(sub.email))?.id).toBe(sub.id);
  });

  it('honours revocation and rejects unknown tokens', async () => {
    const sub = await insertSubscriber({
      email: email('b'),
      topics: [],
      frequency: 'weekly',
      unsubscribeTokenHash: hashToken('seed'),
      source: 'test',
    });
    const raw = `raw-revoke-${Date.now()}`;
    await createSubscriberToken(sub.id, hashToken(raw), 'broadcast-A');
    expect((await findSubscriberByUnsubscribeToken(raw, hashToken))?.id).toBe(sub.id);

    await pool.query(
      `UPDATE newsletter_subscriber_tokens SET revoked_at = now() WHERE token_hash = $1`,
      [hashToken(raw)],
    );
    // Revoked rows never resolve — revocation is explicit, never a send side effect.
    expect(await findSubscriberByUnsubscribeToken(raw, hashToken)).toBeNull();
    expect(await findSubscriberByUnsubscribeToken(`unknown-${Date.now()}`, hashToken)).toBeNull();
  });

  it('enforces token_hash uniqueness across subscribers', async () => {
    const mk = (n: string) =>
      insertSubscriber({
        email: email(n),
        topics: [],
        frequency: 'weekly',
        // Distinct single-column hashes: the uniqueness under test is the
        // token TABLE's, not the subscribers column's.
        unsubscribeTokenHash: hashToken(`seed-${n}-${Date.now()}`),
        source: 'test',
      });
    const s1 = await mk('c1');
    const s2 = await mk('c2');
    const dup = `dup-${Date.now()}`;
    await createSubscriberToken(s1.id, hashToken(dup), 'b1');
    await expect(createSubscriberToken(s2.id, hashToken(dup), 'b2')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('keeps exactly one recipient row under concurrent identical upserts', async () => {
    const sub = await insertSubscriber({
      email: email('d'),
      topics: [],
      frequency: 'weekly',
      unsubscribeTokenHash: hashToken('seed'),
      source: 'test',
    });
    const b = await createBroadcast({ subject: 'S' });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        upsertRecipientOutcome({
          broadcast_id: b.id,
          subscriber_id: sub.id,
          status: 'accepted',
          channel: 'sendgrid',
          error: null,
        }),
      ),
    );
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM newsletter_broadcast_recipients WHERE broadcast_id = $1`,
      [b.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('enforces broadcast idempotency keys, FKs, and cascading deletes', async () => {
    const b = await createBroadcast({ subject: 'S', idempotencyKey: `k-${Date.now()}` });
    await expect(
      createBroadcast({ subject: 'S2', idempotencyKey: undefined }).then(() => b),
    ).resolves.toBeDefined();
    // Same key twice → unique violation (0082 partial index).
    await expect(
      pool.query(
        `INSERT INTO newsletter_broadcasts (subject, idempotency_key) VALUES ('x', $1)`,
        [
          (
            await pool.query(`SELECT idempotency_key AS k FROM newsletter_broadcasts WHERE id = $1`, [
              b.id,
            ])
          ).rows[0].k,
        ],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    // Recipient for a missing broadcast → FK violation.
    await expect(
      upsertRecipientOutcome({
        broadcast_id: '00000000-0000-0000-0000-000000000000',
        subscriber_id: '00000000-0000-0000-0000-000000000000',
        status: 'failed',
        channel: null,
        error: 'x',
      }),
    ).rejects.toMatchObject({ code: '23503' });

    // Token for a missing subscriber → FK violation.
    const { query } = jest.requireMock('../../shared/utils/db') as {
      query: (t: string, p?: unknown[]) => Promise<unknown[]>;
    };
    await expect(
      query(
        `INSERT INTO newsletter_subscriber_tokens (subscriber_id, token_hash) VALUES ($1, $2)`,
        ['00000000-0000-0000-0000-000000000000', 'abc'],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    // Cascade: deleting the broadcast removes its recipients.
    const sub = await insertSubscriber({
      email: email('e'),
      topics: [],
      frequency: 'weekly',
      unsubscribeTokenHash: hashToken('seed'),
      source: 'test',
    });
    await upsertRecipientOutcome({
      broadcast_id: b.id,
      subscriber_id: sub.id,
      status: 'uncertain',
      channel: null,
      error: 'interrupted send',
    });
    await pool.query(`DELETE FROM newsletter_broadcasts WHERE id = $1`, [b.id]);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM newsletter_broadcast_recipients WHERE broadcast_id = $1`,
      [b.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it('tracks the full lifecycle with uncertain aggregates', async () => {
    const sub = await insertSubscriber({
      email: email('f'),
      topics: [],
      frequency: 'weekly',
      unsubscribeTokenHash: hashToken('seed'),
      source: 'test',
    });
    const b = await createBroadcast({ subject: 'Lifecycle', createdBy: '550e8400-e29b-41d4-a716-446655440000' });
    await updateBroadcastStatus(b.id, 'processing');
    await upsertRecipientOutcome({
      broadcast_id: b.id,
      subscriber_id: sub.id,
      status: 'uncertain',
      channel: null,
      error: 'interrupted send',
    });

    const history = await findBroadcastHistoryById(b.id);
    expect(history?.uncertain).toBe(1);
    expect(await listUncertainRecipientIds(b.id)).toEqual([sub.id]);
    expect(await listFailedRecipientIds(b.id)).toEqual([]);

    const grouped = await listUncertainRecipientIdsForBroadcasts([b.id, '00000000-0000-0000-0000-000000000000']);
    expect(grouped).toEqual({ [b.id]: [sub.id] });

    await updateBroadcastStatus(b.id, 'completed', { attempted: 1, accepted: 0, failed: 0, skipped: 0 });
    const rows = await listBroadcastHistoryRows(10, 0);
    expect(rows.find((r) => r.id === b.id)?.status).toBe('completed');

    expect(await isTokenTableAvailable()).toBe(true);
  });

  it('deduplicates concurrent direct additions and preserves opt-outs and links', async () => {
    const input = { email: email('direct'), topics: ['promotions'], frequency: 'weekly' as const, unsubscribeTokenHash: hashToken('direct-seed') };
    const results = await Promise.all([addConfirmedContact(input), addConfirmedContact(input)]);
    expect(results.sort()).toEqual([false, true]);
    const row = await findSubscriberByEmail(input.email);
    expect(row?.status).toBe('confirmed');
    await markUnsubscribed(row!.id);
    await markConfirmed(row!.id); // Simulates a stale public confirmation link.
    expect(await addConfirmedContact({ ...input, unsubscribeTokenHash: hashToken('new-seed') })).toBe(false);
    expect((await findSubscriberByEmail(input.email))?.status).toBe('unsubscribed');
    expect((await findSubscriberByUnsubscribeToken('direct-seed', hashToken))?.id).toBe(row!.id);
  });
});
