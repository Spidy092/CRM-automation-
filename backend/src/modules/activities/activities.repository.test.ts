import { pool, query, queryOne } from '../../shared/utils/db';
import {
  createOutboundActivityAndUpdateLead,
  findActivitiesByLeadId,
  findActivityById,
  findActivityAuthors,
  findFirstContactedAt,
  insertActivity,
  setActivityPinned,
} from './activities.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const mockedPoolQuery = pool.query as jest.Mock;
const mockedQuery = query as jest.MockedFunction<typeof query>;
const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;

const baseActivity = {
  id: 'act-1',
  lead_id: 'lead-1',
  user_id: 'user-1',
  type: 'note' as const,
  metadata: { note: 'hello' },
  created_at: '2026-06-19T00:00:00.000Z',
};

describe('activities.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('insertActivity', () => {
    it('inserts and returns activity', async () => {
      mockedPoolQuery.mockResolvedValue({ rows: [baseActivity] });
      const res = await insertActivity({
        lead_id: 'lead-1',
        user_id: 'user-1',
        type: 'note',
        metadata: { note: 'hello' },
      });
      expect(res).toEqual(baseActivity);
      expect(mockedPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activities'),
        ['lead-1', 'user-1', 'note', JSON.stringify({ note: 'hello' })],
      );
    });

    it('throws when insert returns no row', async () => {
      mockedPoolQuery.mockResolvedValue({ rows: [] });
      await expect(
        insertActivity({ lead_id: 'lead-1', user_id: 'user-1', type: 'call' }),
      ).rejects.toThrow('Failed to insert activity');
    });
  });

  describe('findFirstContactedAt', () => {
    it('returns date when present', async () => {
      const date = new Date('2026-06-19T00:00:00.000Z');
      mockedQueryOne.mockResolvedValue({ first_contacted_at: date });
      const res = await findFirstContactedAt('lead-1');
      expect(res).toEqual(date);
    });

    it('returns null when lead missing', async () => {
      mockedQueryOne.mockResolvedValue(null);
      const res = await findFirstContactedAt('lead-1');
      expect(res).toBeNull();
    });
  });

  describe('createOutboundActivityAndUpdateLead', () => {
    it('inserts activity and updates lead first_contacted_at', async () => {
      mockedPoolQuery.mockResolvedValue({ rows: [baseActivity] });
      mockedQueryOne.mockResolvedValueOnce({ first_contacted_at: new Date() });
      const res = await createOutboundActivityAndUpdateLead({
        lead_id: 'lead-1',
        user_id: 'user-1',
        type: 'email',
        metadata: { subject: 'Hi' },
      });
      expect(res).toEqual(baseActivity);
      expect(mockedQueryOne).toHaveBeenLastCalledWith(
        expect.stringContaining('UPDATE leads'),
        ['lead-1'],
      );
    });
  });

  describe('findActivitiesByLeadId', () => {
    it('returns paginated activities without type filter', async () => {
      mockedQueryOne.mockResolvedValue({ total: '2' });
      mockedQuery.mockResolvedValue([
        { ...baseActivity, user_name: 'User One', user_email: 'u1@example.com' },
        { ...baseActivity, id: 'act-2', user_name: null, user_email: null },
      ]);

      const res = await findActivitiesByLeadId({
        leadId: 'lead-1',
        limit: 25,
        offset: 0,
      });

      expect(res.items).toHaveLength(2);
      expect(res.meta.total).toBe(2);
      expect(res.meta.limit).toBe(25);
      expect(res.meta.offset).toBe(0);
      expect(mockedQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)::text AS total'),
        ['lead-1'],
      );
    });

    it('applies type filter', async () => {
      mockedQueryOne.mockResolvedValue({ total: '1' });
      mockedQuery.mockResolvedValue([
        { ...baseActivity, type: 'call', user_name: 'User One', user_email: 'u1@example.com' },
      ]);

      await findActivitiesByLeadId({ leadId: 'lead-1', limit: 10, offset: 5, type: 'call' });

      const [, params] = mockedQuery.mock.calls[0];
      // One extra row is fetched to determine hasMore.
      expect(params).toEqual(['lead-1', 'call', 11, 5]);
    });

    it('pages with a keyset cursor instead of offset and returns nextCursor', async () => {
      mockedQueryOne.mockResolvedValue({ total: '3' });
      const rows = [0, 1].map((n) => ({
        ...baseActivity,
        id: `act-${n}`,
        created_at: `2026-06-19T00:00:0${n}.000Z`,
        user_name: null,
        user_email: null,
        is_pinned: false,
      }));
      mockedQuery.mockResolvedValue(rows);

      const res = await findActivitiesByLeadId({
        leadId: 'lead-1',
        limit: 1,
        offset: 0,
        cursorTs: '2026-06-20T00:00:00.000Z',
        cursorId: 'act-9',
      });

      expect(res.items).toHaveLength(1);
      expect(res.meta.hasMore).toBe(true);
      expect(res.meta.nextCursor).toBeDefined();
      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('(a.created_at, a.id) < (');
      expect(sql).not.toContain('OFFSET');
      expect((params as unknown[]).slice(0, 3)).toEqual([
        'lead-1',
        '2026-06-20T00:00:00.000Z',
        'act-9',
      ]);
    });

    it('applies search, author, date, and pinned filters server-side', async () => {
      mockedQueryOne.mockResolvedValue({ total: '1' });
      mockedQuery.mockResolvedValue([
        { ...baseActivity, user_name: 'User One', user_email: 'u1@example.com', is_pinned: true },
      ]);

      await findActivitiesByLeadId({
        leadId: 'lead-1',
        limit: 25,
        offset: 0,
        search: 'follow up',
        authorId: 'user-1',
        dateFrom: '2026-06-01T00:00:00.000Z',
        dateTo: '2026-06-30T00:00:00.000Z',
        pinnedOnly: true,
      });

      const [sql, params] = mockedQuery.mock.calls[0];
      expect(sql).toContain('ILIKE');
      expect(sql).toContain(`COALESCE((a.metadata->>'pinned')::boolean, false) = true`);
      expect(params).toEqual([
        'lead-1',
        '%follow up%',
        'user-1',
        '2026-06-01T00:00:00.000Z',
        '2026-06-30T00:00:00.000Z',
        26,
      ]);
    });
  });

  describe('findActivityById', () => {
    it('returns the activity row', async () => {
      mockedQueryOne.mockResolvedValue(baseActivity);
      const res = await findActivityById('act-1');
      expect(res).toEqual(baseActivity);
    });
  });

  describe('setActivityPinned', () => {
    it('appends the pin marker to metadata without rewriting history', async () => {
      mockedQueryOne.mockResolvedValue({ ...baseActivity, is_pinned: true });
      const res = await setActivityPinned('act-1', true, 'user-1');
      expect(res?.is_pinned).toBe(true);
      const [sql, params] = mockedQueryOne.mock.calls[0];
      expect(sql).toContain('UPDATE activities');
      expect(sql).toContain(`'pinned'`);
      expect(params).toEqual(['act-1', 'user-1']);
    });
  });
});

describe('history author options', () => {
  it('queries distinct authors across the lead history without a page limit', async () => {
    mockedQuery.mockResolvedValue([{ id: 'user-1', name: 'User One' }]);
    expect(await findActivityAuthors('lead-1')).toEqual([{ id: 'user-1', name: 'User One' }]);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT'), ['lead-1']);
  });
});

it('unpins with exactly the SQL parameters referenced by the query', async () => {
  mockedQueryOne.mockResolvedValue({ ...baseActivity, is_pinned: false });
  await setActivityPinned('act-1', false, 'user-1');
  const [sql, params] = mockedQueryOne.mock.calls.at(-1)!;
  expect(sql).not.toContain('$2');
  expect(params).toEqual(['act-1']);
});
