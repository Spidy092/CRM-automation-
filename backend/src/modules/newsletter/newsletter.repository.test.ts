import { addConfirmedContact } from './newsletter.repository';
import { query, queryOne } from '../../shared/utils/db';
import {
  findSubscriberByEmail,
  findSubscriberById,
  findSubscriberByUnsubscribeTokenHash,
  findSubscriberByUnsubscribeToken,
  findSubscriberByTokenTableHash,
  createSubscriberToken,
  isMissingRelationError,
  insertSubscriber,
  resetToPending,
  markConfirmed,
  markUnsubscribed,
  updatePreferences,
  updateUnsubscribeTokenHash,
  findSubscribers,
  countSubscribers,
  countSubscribersByStatus,
  findEligibleSubscribers,
  countEligibleSubscribers,
  createBroadcast,
  findBroadcastById,
  findBroadcastByIdempotencyKey,
  setBroadcastContent,
  updateBroadcastStatus,
  listBroadcasts,
  listBroadcastHistoryRows,
  findBroadcastHistoryById,
  upsertRecipientOutcome,
  listFailedRecipientIds,
  listUncertainRecipientIds,
  listUncertainRecipientIdsForBroadcasts,
  findBroadcastFrequencies,
  isTokenTableAvailable,
  isSendLimitStorageAvailable,
  reserveNewsletterSend,
  finishNewsletterSend,
} from './newsletter.repository';

jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));
jest.mock('../../shared/utils/metrics', () => ({
  incNewsletterLegacyTokenHit: jest.fn(),
}));

import { incNewsletterLegacyTokenHit } from '../../shared/utils/metrics';

const mockQuery = query as unknown as jest.Mock;
const mockQueryOne = queryOne as unknown as jest.Mock;

const baseRow = {
  id: 'sub-1',
  email: 'lead@example.com',
  status: 'pending',
  topics: ['promotions'],
  frequency: 'weekly',
  unsubscribe_token_hash: 'hash123',
  source: 'website',
  confirmed_at: null,
  unsubscribed_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

describe('newsletter.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findSubscriberByEmail returns a mapped row with parsed topics', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const row = await findSubscriberByEmail('lead@example.com');
    expect(row).toMatchObject({ id: 'sub-1', topics: ['promotions'] });
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('lower(email) = lower($1)');
    expect(params).toEqual(['lead@example.com']);
  });

  it('findSubscriberByEmail parses topics returned as a JSON string', async () => {
    mockQueryOne.mockResolvedValue({ ...baseRow, topics: '["company_news"]' });
    const row = await findSubscriberByEmail('lead@example.com');
    expect(row?.topics).toEqual(['company_news']);
  });

  it('findSubscriberByEmail returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findSubscriberByEmail('missing@example.com')).toBeNull();
  });

  it('findSubscriberById queries by id', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const row = await findSubscriberById('sub-1');
    expect(row?.id).toBe('sub-1');
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['sub-1']);
  });

  it('findSubscriberByUnsubscribeTokenHash queries by token hash', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const row = await findSubscriberByUnsubscribeTokenHash('hash123');
    expect(row?.unsubscribe_token_hash).toBe('hash123');
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['hash123']);
  });

  it('insertSubscriber inserts and returns the mapped row', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const row = await insertSubscriber({
      email: 'lead@example.com',
      topics: ['promotions'],
      frequency: 'weekly',
      unsubscribeTokenHash: 'hash123',
      source: 'website',
    });
    expect(row.id).toBe('sub-1');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('INSERT INTO newsletter_subscribers');
    expect(params).toEqual(['lead@example.com', JSON.stringify(['promotions']), 'weekly', 'hash123', 'website']);
  });

  it('insertSubscriber throws AppError when no row is returned', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      insertSubscriber({
        email: 'lead@example.com',
        topics: [],
        frequency: 'weekly',
        unsubscribeTokenHash: 'hash123',
        source: null,
      }),
    ).rejects.toThrow('Failed to create subscriber');
  });

  it('resetToPending resets status/topics/frequency and clears timestamps', async () => {
    mockQueryOne.mockResolvedValue({ ...baseRow, status: 'pending' });
    const row = await resetToPending('sub-1', ['product_updates'], 'daily');
    expect(row.status).toBe('pending');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain('confirmed_at = NULL');
    expect(params).toEqual(['sub-1', JSON.stringify(['product_updates']), 'daily']);
  });

  it('resetToPending throws AppError when subscriber not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(resetToPending('missing', [], 'weekly')).rejects.toThrow('Subscriber not found');
  });

  it('markConfirmed issues an update query', async () => {
    mockQuery.mockResolvedValue([]);
    await markConfirmed('sub-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'confirmed'");
    expect(params).toEqual(['sub-1', JSON.stringify(['product_updates', 'promotions', 'company_news'])]);
    expect(sql).toContain("status = 'pending'");
  });

  it('reserves subscriber delivery using the rolling window and persisted preferences', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sub-1' });
    expect(await reserveNewsletterSend('sub-1', 'broadcast-1')).toBe(true);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain("interval '168 hours'");
    expect(sql).toContain("interval '720 hours'");
    expect(sql).toContain("status = 'confirmed'");
    expect(sql).toContain('newsletter_reserved_until <= now()');
    expect(params).toEqual(['sub-1', 'broadcast-1', null]);
  });

  it('only reclaims the matching held reservation for an explicitly opted-in uncertain retry', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sub-1' });
    expect(await reserveNewsletterSend('sub-1', 'retry-1', 'source-1')).toBe(true);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('newsletter_reservation_key = $3');
    expect(sql).toContain('newsletter_reserved_until > now()');
    expect(sql).toContain('newsletter_last_accepted_at IS NULL OR');
    expect(params).toEqual(['sub-1', 'retry-1', 'source-1']);
  });

  it('records accepted sends and releases a known-failed reservation', async () => {
    mockQuery.mockResolvedValue([]);
    await finishNewsletterSend('sub-1', 'broadcast-1', true);
    expect(mockQuery.mock.calls[0][0]).toContain('newsletter_last_accepted_at');
    expect(mockQuery.mock.calls[0][1]).toEqual(['sub-1', 'broadcast-1', true]);
    await finishNewsletterSend('sub-1', 'broadcast-1', false);
    expect(mockQuery.mock.calls[1][1]).toEqual(['sub-1', 'broadcast-1', false]);
  });

  it('markUnsubscribed issues an update query', async () => {
    mockQuery.mockResolvedValue([]);
    await markUnsubscribed('sub-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status = 'unsubscribed'");
    expect(params).toEqual(['sub-1']);
  });

  it('updatePreferences builds a partial SET clause for topics only', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    await updatePreferences('sub-1', { topics: ['company_news'] });
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('topics = $1::jsonb');
    expect(sql).not.toContain('frequency = $');
    expect(params).toEqual([JSON.stringify(['company_news']), 'sub-1']);
  });

  it('updatePreferences builds a SET clause for both fields', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    await updatePreferences('sub-1', { topics: ['company_news'], frequency: 'monthly' });
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('topics = $1::jsonb');
    expect(sql).toContain('frequency = $2');
    expect(params).toEqual([JSON.stringify(['company_news']), 'monthly', 'sub-1']);
  });

  it('updatePreferences throws AppError when subscriber not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updatePreferences('missing', { frequency: 'daily' })).rejects.toThrow('Subscriber not found');
  });

  it('findSubscribers filters by status when provided', async () => {
    mockQuery.mockResolvedValue([baseRow]);
    const rows = await findSubscribers(25, 0, 'pending');
    expect(rows).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE status = $1');
    expect(params).toEqual(['pending', 25, 0]);
  });

  it('findSubscribers omits the status filter when absent', async () => {
    mockQuery.mockResolvedValue([]);
    await findSubscribers(25, 0);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE status');
    expect(params).toEqual([25, 0]);
  });

  it('countSubscribers returns a parsed count, filtered by status', async () => {
    mockQueryOne.mockResolvedValue({ total: '3' });
    const total = await countSubscribers('confirmed');
    expect(total).toBe(3);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('WHERE status = $1');
    expect(params).toEqual(['confirmed']);
  });

  it('countSubscribers defaults to 0 when no row is returned', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await countSubscribers()).toBe(0);
  });

  it('findSubscriberByUnsubscribeToken resolves via the token table first', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const hashFn = (t: string): string => `hashed:${t}`;
    const row = await findSubscriberByUnsubscribeToken('raw-token', hashFn);
    expect(row?.id).toBe('sub-1');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('newsletter_subscriber_tokens');
    expect(params).toEqual(['hashed:raw-token']);
  });

  it('links from two successive broadcasts both resolve (no invalidation)', async () => {
    // Emulate the token table holding one appended row per send: two
    // broadcasts minted token A then token B for the same subscriber.
    const tableHashes = new Set(['hashed:raw-A', 'hashed:raw-B']);
    mockQueryOne.mockImplementation(async (sql: string, params: unknown[]) => {
      if (String(sql).includes('newsletter_subscriber_tokens')) {
        return tableHashes.has(params[0] as string) ? { ...baseRow } : null;
      }
      return null;
    });
    const hashFn = (t: string): string => `hashed:${t}`;
    const first = await findSubscriberByUnsubscribeToken('raw-A', hashFn);
    const second = await findSubscriberByUnsubscribeToken('raw-B', hashFn);
    expect(first?.id).toBe('sub-1');
    expect(second?.id).toBe('sub-1');
    // Both resolved via appended rows; the single-hash column was never
    // consulted and nothing was overwritten (mockQuery = writes).
    expect(mockQuery).not.toHaveBeenCalled();
    for (const [, params] of mockQueryOne.mock.calls) {
      expect(tableHashes.has(params[0] as string)).toBe(true);
    }
  });

  it('findSubscriberByUnsubscribeToken falls back to the single column when the table is missing', async () => {
    const missing = Object.assign(new Error('relation "newsletter_subscriber_tokens" does not exist'), {
      code: '42P01',
    });
    mockQueryOne
      .mockRejectedValueOnce(missing)
      .mockResolvedValueOnce({ ...baseRow, unsubscribe_token_hash: 'hashed:raw-token' });
    const hashFn = (t: string): string => `hashed:${t}`;
    const row = await findSubscriberByUnsubscribeToken('raw-token', hashFn);
    expect(row?.id).toBe('sub-1');
    expect(mockQueryOne.mock.calls[1][1]).toEqual(['hashed:raw-token']);
  });

  it('findSubscriberByUnsubscribeToken falls back to legacy hash-in-link', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...baseRow, unsubscribe_token_hash: 'legacy-hash' });
    const hashFn = (t: string): string => `hashed:${t}`;
    const row = await findSubscriberByUnsubscribeToken('legacy-hash', hashFn);
    expect(row?.unsubscribe_token_hash).toBe('legacy-hash');
    expect(mockQueryOne.mock.calls[2][1]).toEqual(['legacy-hash']);
    // Legacy hits are metered for the sunset telemetry (never a removal trigger alone).
    expect(incNewsletterLegacyTokenHit).toHaveBeenCalled();
  });

  it('isTokenTableAvailable probes without side effects', async () => {
    mockQueryOne.mockResolvedValue({ one: 1 });
    await expect(isTokenTableAvailable()).resolves.toBe(true);
    mockQueryOne.mockRejectedValueOnce(
      Object.assign(new Error('relation "newsletter_subscriber_tokens" does not exist'), {
        code: '42P01',
      }),
    );
    await expect(isTokenTableAvailable()).resolves.toBe(false);
    mockQueryOne.mockRejectedValueOnce(new Error('connection refused'));
    await expect(isTokenTableAvailable()).rejects.toThrow('connection refused');
  });

  it('isSendLimitStorageAvailable rejects pre-0084 schemas and propagates unrelated failures', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(isSendLimitStorageAvailable()).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain('newsletter_reserved_until');
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('column newsletter_reserved_until does not exist'), { code: '42703' }),
    );
    await expect(isSendLimitStorageAvailable()).resolves.toBe(false);
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    await expect(isSendLimitStorageAvailable()).rejects.toThrow('connection refused');
  });

  it('listUncertainRecipientIds queries the uncertain state only', async () => {
    mockQuery.mockResolvedValue([{ subscriber_id: 'sub-u1' }]);
    expect(await listUncertainRecipientIds('b-1')).toEqual(['sub-u1']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'uncertain'`);
    expect(params).toEqual(['b-1']);
  });

  it('listUncertainRecipientIdsForBroadcasts groups one query across broadcasts', async () => {
    mockQuery.mockResolvedValue([
      { broadcast_id: 'b-1', subscriber_id: 'u1' },
      { broadcast_id: 'b-1', subscriber_id: 'u2' },
      { broadcast_id: 'b-2', subscriber_id: 'u3' },
    ]);
    const grouped = await listUncertainRecipientIdsForBroadcasts(['b-1', 'b-2']);
    expect(grouped).toEqual({ 'b-1': ['u1', 'u2'], 'b-2': ['u3'] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('= ANY($1)');
    expect(params).toEqual([['b-1', 'b-2']]);
    expect(await listUncertainRecipientIdsForBroadcasts([])).toEqual({});
  });

  it('listBroadcastHistoryRows derives the uncertain aggregate per broadcast', async () => {
    mockQuery.mockResolvedValue([
      { ...baseRow, id: 'b-1', uncertain_count: '2', topics: '[]' },
    ]);
    const rows = await listBroadcastHistoryRows(50, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0].uncertain).toBe(2);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'uncertain'`);
  });

  it('findBroadcastHistoryById returns the row with its uncertain count', async () => {
    mockQueryOne.mockResolvedValue({ ...baseRow, id: 'b-1', uncertain_count: 0, topics: '[]' });
    const row = await findBroadcastHistoryById('b-1');
    expect(row?.id).toBe('b-1');
    expect(row?.uncertain).toBe(0);
  });

  it('findSubscriberByTokenTableHash only matches non-revoked rows', async () => {
    mockQueryOne.mockResolvedValue(baseRow);
    const row = await findSubscriberByTokenTableHash('hashABC');
    expect(row?.id).toBe('sub-1');
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(params).toEqual(['hashABC']);
  });

  it('createSubscriberToken appends a row and never overwrites', async () => {
    mockQuery.mockResolvedValue([]);
    await createSubscriberToken('sub-1', 'hashABC', 'job-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO newsletter_subscriber_tokens');
    expect(sql).not.toContain('UPDATE');
    expect(params).toEqual(['sub-1', 'hashABC', 'job-1']);
  });

  it('isMissingRelationError detects only missing-table errors', async () => {
    expect(isMissingRelationError(Object.assign(new Error('x'), { code: '42P01' }))).toBe(true);
    expect(
      isMissingRelationError(new Error('relation "foo" does not exist')),
    ).toBe(true);
    expect(isMissingRelationError(new Error('connection refused'))).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });

  it('updateUnsubscribeTokenHash persists only the hash', async () => {
    mockQuery.mockResolvedValue([]);
    await updateUnsubscribeTokenHash('sub-1', 'newhash');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('unsubscribe_token_hash = $2');
    expect(params).toEqual(['sub-1', 'newhash']);
  });

  it('findSubscribers applies search/topic/source/frequency filters parameterized', async () => {
    mockQuery.mockResolvedValue([baseRow]);
    await findSubscribers(25, 0, undefined, {
      search: 'lead@',
      topic: 'promotions',
      source: 'website',
      frequency: 'weekly',
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('email ILIKE');
    expect(sql).toContain('topics @>');
    expect(sql).toContain('source = $');
    expect(sql).toContain('frequency = $');
    expect(params).toContain('website');
    // No string interpolation of user input into SQL.
    expect(sql).not.toContain('lead@');
  });

  it('countSubscribersByStatus returns audience-wide counts', async () => {
    mockQuery.mockResolvedValue([
      { status: 'confirmed', total: '5' },
      { status: 'pending', total: '2' },
    ]);
    const counts = await countSubscribersByStatus();
    expect(counts).toEqual({ pending: 2, confirmed: 5, unsubscribed: 0, total: 7 });
  });

  it('orders subscriber list pages by timestamp and unique ID', async () => {
    mockQuery.mockResolvedValue([]);
    await findSubscribers(100, 0);
    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC');
  });

  it('uses immutable ID keysets for broadcast pages without OFFSET', async () => {
    mockQuery.mockResolvedValue([]);
    await findEligibleSubscribers(100, null);
    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY id DESC');
    expect(mockQuery.mock.calls[0][0]).not.toContain('OFFSET');
    await findEligibleSubscribers(100, '00000000-0000-4000-8000-000000000001', { frequency: 'weekly' });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain('id < $2::uuid');
    expect(sql).not.toContain('OFFSET');
    expect(params).toEqual(['weekly', '00000000-0000-4000-8000-000000000001', 100]);
  });

  it('findEligibleSubscribers only queries confirmed and rechecks apply topic/frequency', async () => {
    mockQuery.mockResolvedValue([baseRow]);
    await findEligibleSubscribers(100, 0, { topics: ['promotions'], frequency: 'weekly' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'confirmed'`);
    expect(sql).not.toContain(`status = 'pending'`);
    expect(sql).not.toContain(`status = 'unsubscribed'`);
    expect(params).toContain('weekly');
  });

  it('findEligibleSubscribers matches any frequency in a list via ANY', async () => {
    mockQuery.mockResolvedValue([baseRow]);
    await findEligibleSubscribers(100, 0, { frequency: ['daily', 'weekly'] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('frequency = ANY($');
    expect(params).toContainEqual(['daily', 'weekly']);
    // Single frequency keeps equality semantics (no ANY).
    mockQuery.mockResolvedValue([baseRow]);
    await findEligibleSubscribers(100, 0, { frequency: 'monthly' });
    const [sql2] = mockQuery.mock.calls[1];
    expect(sql2).not.toContain('ANY');
    expect(sql2).toContain('frequency = $');
  });

  it('findEligibleSubscribers with an empty frequency list matches nothing', async () => {
    mockQuery.mockResolvedValue([]);
    await findEligibleSubscribers(100, 0, { frequency: [] });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('FALSE');
  });

  it('countEligibleSubscribers supports frequency lists', async () => {
    mockQueryOne.mockResolvedValue({ total: '6' });
    expect(await countEligibleSubscribers({ frequency: ['daily', 'weekly'] })).toBe(6);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('frequency = ANY($');
    expect(params).toContainEqual(['daily', 'weekly']);
  });

  it('countEligibleSubscribers counts confirmed-only recipients', async () => {
    mockQueryOne.mockResolvedValue({ total: '4' });
    expect(await countEligibleSubscribers({ frequency: 'daily' })).toBe(4);
    const [sql] = mockQueryOne.mock.calls[0];
    expect(sql).toContain(`status = 'confirmed'`);
  });

  it('createBroadcast inserts lifecycle row with creator/audience/schedule', async () => {
    const row = {
      id: 'b-1',
      subject: 'S',
      preview_text: null,
      topics: ['promotions'],
      frequency: 'weekly',
      timezone: 'Asia/Kolkata',
      scheduled_at: '2026-05-01T03:30:00.000Z',
      status: 'scheduled',
      attempted: 0,
      accepted: 0,
      failed: 0,
      skipped: 0,
      created_by: 'admin-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    mockQueryOne.mockResolvedValue(row);
    mockQuery.mockResolvedValue([]);
    const created = await createBroadcast({
      subject: 'S',
      topics: ['promotions'],
      frequency: 'weekly',
      timezone: 'Asia/Kolkata',
      scheduledAtUtc: '2026-05-01T03:30:00.000Z',
      createdBy: 'admin-1',
      status: 'scheduled',
    });
    expect(created.id).toBe('b-1');
    expect(created.topics).toEqual(['promotions']);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('INSERT INTO newsletter_broadcasts');
    expect(params).toContain('admin-1');
  });

  it('createBroadcast persists the frequency list best-effort (0083)', async () => {
    mockQueryOne.mockResolvedValue({ id: 'b-1', topics: '[]' });
    mockQuery.mockResolvedValue([]);
    await createBroadcast({ subject: 'S', frequencies: ['daily', 'weekly'] });
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('SET frequencies = '),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual(['b-1', JSON.stringify(['daily', 'weekly'])]);
  });

  it('createBroadcast tolerates a 0079-only database without the frequencies column', async () => {
    mockQueryOne.mockResolvedValue({ id: 'b-1', topics: '[]' });
    mockQuery.mockRejectedValue(
      Object.assign(new Error('column "frequencies" does not exist'), { code: '42703' }),
    );
    const created = await createBroadcast({ subject: 'S', frequencies: ['daily'] });
    expect(created.id).toBe('b-1');
  });

  it('findBroadcastFrequencies groups valid frequencies and swallows missing-column errors', async () => {
    mockQuery.mockResolvedValue([
      { id: 'b-1', frequencies: ['daily', 'weekly'] },
      { id: 'b-2', frequencies: '["monthly", "bogus"]' },
    ]);
    expect(await findBroadcastFrequencies(['b-1', 'b-2'])).toEqual({
      'b-1': ['daily', 'weekly'],
      'b-2': ['monthly'],
    });
    mockQuery.mockRejectedValue(
      Object.assign(new Error('column "frequencies" does not exist'), { code: '42703' }),
    );
    expect(await findBroadcastFrequencies(['b-1'])).toEqual({});
  });

  it('upsertRecipientOutcome is idempotent via ON CONFLICT', async () => {
    mockQuery.mockResolvedValue([]);
    await upsertRecipientOutcome({
      broadcast_id: 'b-1',
      subscriber_id: 'sub-1',
      status: 'accepted',
      channel: 'sendgrid',
      error: null,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (broadcast_id, subscriber_id)');
    expect(params).toEqual(['b-1', 'sub-1', 'accepted', 'sendgrid', null]);
  });

  it('findBroadcastById returns null when missing', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findBroadcastById('gone')).toBeNull();
  });

  it('listFailedRecipientIds returns only failed subscriber ids', async () => {
    mockQuery.mockResolvedValue([{ subscriber_id: 'sub-9' }]);
    expect(await listFailedRecipientIds('b-1')).toEqual(['sub-9']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`status = 'failed'`);
    expect(params).toEqual(['b-1']);
  });

  it('updateBroadcastStatus writes terminal counts', async () => {
    mockQuery.mockResolvedValue([]);
    await updateBroadcastStatus('b-1', 'partially_failed', {
      attempted: 3,
      accepted: 2,
      failed: 1,
      skipped: 0,
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('SET status = $2');
    expect(params).toEqual(['b-1', 'partially_failed', 3, 2, 1, 0]);
  });

  it('setBroadcastContent swallows undefined-column errors (0079-only db)', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('column "html_body" does not exist'), { code: '42703' }));
    await expect(setBroadcastContent('b-1', { htmlBody: '<p>x</p>' })).resolves.toBeUndefined();
  });

  it('listBroadcasts orders newest first with pagination', async () => {
    mockQuery.mockResolvedValue([]);
    await listBroadcasts(50, 0);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual([50, 0]);
  });

  it('findBroadcastByIdempotencyKey returns null on a 0079-only db', async () => {
    mockQueryOne.mockRejectedValue(
      Object.assign(new Error('column "idempotency_key" does not exist'), { code: '42703' }),
    );
    expect(await findBroadcastByIdempotencyKey('k')).toBeNull();
  });
});

describe('direct contact persistence', () => {
  beforeEach(() => jest.clearAllMocks());
  it('uses case-insensitive dedupe and cannot reactivate unsubscribed conflicts', async () => {
    const input = { email: 'contact@example.com', topics: ['promotions'], frequency: 'weekly' as const, unsubscribeTokenHash: 'hash' };
    mockQueryOne.mockResolvedValue({ id: 'sub-1' });
    expect(await addConfirmedContact(input)).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("WHERE newsletter_subscribers.status = 'pending'"), ['contact@example.com', '["promotions"]', 'weekly', 'hash']);
    expect(mockQueryOne.mock.calls[0][0]).toContain('ON CONFLICT (lower(email))');
    mockQueryOne.mockResolvedValue(null);
    expect(await addConfirmedContact(input)).toBe(false);
  });
});

it('confirmation of an older public signup cannot reactivate an unsubscribed contact', async () => {
  mockQuery.mockResolvedValue([]);
  await markConfirmed('sub-1');
  expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("WHERE id = $1 AND status = 'pending'"), ['sub-1', JSON.stringify(['product_updates', 'promotions', 'company_news'])]);
});
