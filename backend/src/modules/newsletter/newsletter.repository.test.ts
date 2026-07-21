import { query, queryOne } from '../../shared/utils/db';
import {
  findSubscriberByEmail,
  findSubscriberById,
  findSubscriberByUnsubscribeTokenHash,
  insertSubscriber,
  resetToPending,
  markConfirmed,
  markUnsubscribed,
  updatePreferences,
  findSubscribers,
  countSubscribers,
} from './newsletter.repository';

jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

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
    expect(params).toEqual(['sub-1']);
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
});
