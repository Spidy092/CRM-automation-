import { query, queryOne } from '../../shared/utils/db';
import {
  createOutboundActivityAndUpdateLead,
  findActivitiesByLeadId,
  findFirstContactedAt,
  insertActivity,
} from './activities.repository';

jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

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
      mockedQueryOne.mockResolvedValue(baseActivity);
      const res = await insertActivity({
        lead_id: 'lead-1',
        user_id: 'user-1',
        type: 'note',
        metadata: { note: 'hello' },
      });
      expect(res).toEqual(baseActivity);
      expect(mockedQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activities'),
        ['lead-1', 'user-1', 'note', { note: 'hello' }],
      );
    });

    it('throws when insert returns no row', async () => {
      mockedQueryOne.mockResolvedValue(null);
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
      mockedQueryOne
        .mockResolvedValueOnce(baseActivity)
        .mockResolvedValueOnce({ first_contacted_at: new Date() });
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
      expect(params).toEqual(['lead-1', 'call', 10, 5]);
    });
  });
});
