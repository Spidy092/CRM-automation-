import { pool } from '../../shared/utils/db';
import {
  findCampaigns,
  findCampaignById,
  insertCampaign,
  updateCampaign,
  deleteCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  addLeadsToCampaign,
  removeLeadFromCampaign,
  findCampaignLeads,
  getCampaignStats,
} from './campaigns.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

describe('campaigns.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findCampaigns', () => {
    it('returns non-deleted campaigns', async () => {
      const rows = [{ id: 'c1', name: 'Spring' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      await expect(findCampaigns()).resolves.toEqual(rows);
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('deleted_at IS NULL'));
    });
  });

  describe('findCampaignById', () => {
    it('returns row when found', async () => {
      const row = { id: 'c1', name: 'Spring' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findCampaignById('c1')).resolves.toEqual(row);
    });

    it('returns null when missing', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findCampaignById('missing')).resolves.toBeNull();
    });
  });

  describe('insertCampaign', () => {
    it('inserts with all fields', async () => {
      const row = { id: 'c1', name: 'Spring' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await insertCampaign(
        {
          name: 'Spring',
          tone: 'friendly',
          target_industries: ['saas'],
          target_countries: ['US'],
          sequence_id: 'seq-1',
          pipeline_id: 'pipe-1',
        },
        'admin-1',
      );
      expect(result).toEqual(row);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaigns'),
        ['Spring', 'friendly', ['saas'], ['US'], 'seq-1', 'pipe-1', false, 'admin-1'],
      );
    });

    it('defaults sequence_id and pipeline_id to null', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([{ id: 'c1' }]));
      await insertCampaign(
        { name: 'X', tone: 'formal', target_industries: [], target_countries: [] },
        'admin-1',
      );
      expect(mockPoolQuery).toHaveBeenCalledWith(expect.any(String), [
        'X',
        'formal',
        [],
        [],
        null,
        null,
        false,
        'admin-1',
      ]);
    });
  });

  describe('updateCampaign', () => {
    it('updates specified fields', async () => {
      const row = { id: 'c1', name: 'Renamed' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await updateCampaign('c1', { name: 'Renamed' });
      expect(result).toEqual(row);
    });

    it('throws 404 when no row', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(updateCampaign('missing', { name: 'x' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('deleteCampaign', () => {
    it('soft-deletes by setting deleted_at', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await deleteCampaign('c1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('deleted_at = NOW()'),
        ['c1'],
      );
    });
  });

  describe('launchCampaign', () => {
    it('sets status to active and launched_at', async () => {
      const row = { id: 'c1', status: 'active' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(launchCampaign('c1')).resolves.toEqual(row);
    });

    it('throws 404 when not found', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(launchCampaign('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('pauseCampaign', () => {
    it('sets status to paused', async () => {
      const row = { id: 'c1', status: 'paused' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(pauseCampaign('c1')).resolves.toEqual(row);
    });

    it('throws 404 when not found', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(pauseCampaign('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('resumeCampaign', () => {
    it('sets status to active', async () => {
      const row = { id: 'c1', status: 'active' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(resumeCampaign('c1')).resolves.toEqual(row);
    });
  });

  describe('addLeadsToCampaign', () => {
    it('inserts each lead and returns inserted rows', async () => {
      const inserted = [
        { campaign_id: 'c1', lead_id: 'l1' },
        { campaign_id: 'c1', lead_id: 'l2' },
      ];
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([inserted[0]]))
        .mockResolvedValueOnce(mockQueryResult([inserted[1]]));
      const result = await addLeadsToCampaign('c1', ['l1', 'l2']);
      expect(result).toEqual(inserted);
    });

    it('skips duplicates silently when ON CONFLICT returns no row', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ campaign_id: 'c1', lead_id: 'l1' }]))
        .mockResolvedValueOnce(mockQueryResult([])); // duplicate
      const result = await addLeadsToCampaign('c1', ['l1', 'l2']);
      expect(result).toHaveLength(1);
    });

    it('swallows 23505 duplicate error and continues', async () => {
      const dupError = Object.assign(new Error('dup'), { code: '23505' });
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ campaign_id: 'c1', lead_id: 'l1' }]))
        .mockRejectedValueOnce(dupError);
      const result = await addLeadsToCampaign('c1', ['l1', 'l2']);
      expect(result).toHaveLength(1);
    });

    it('rethrows non-duplicate errors', async () => {
      const otherError = Object.assign(new Error('boom'), { code: '42P01' });
      mockPoolQuery.mockRejectedValueOnce(otherError);
      await expect(addLeadsToCampaign('c1', ['l1'])).rejects.toBe(otherError);
    });
  });

  describe('removeLeadFromCampaign', () => {
    it('deletes campaign_lead row', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await removeLeadFromCampaign('c1', 'l1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM campaign_leads'),
        ['c1', 'l1'],
      );
    });
  });

  describe('findCampaignLeads', () => {
    it('returns lead_id list', async () => {
      const rows = [{ lead_id: 'l1' }, { lead_id: 'l2' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      const result = await findCampaignLeads('c1');
      expect(result).toEqual(['l1', 'l2']);
    });

    it('returns empty array when no leads', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findCampaignLeads('c1')).resolves.toEqual([]);
    });
  });

  describe('getCampaignStats', () => {
    it('aggregates outreach statuses', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ total: '10' }]))
        .mockResolvedValueOnce(
          mockQueryResult([
            { status: 'sent', count: '5' },
            { status: 'delivered', count: '4' },
            { status: 'opened', count: '2' },
            { status: 'replied', count: '1' },
            { status: 'failed', count: '3' },
          ]),
        );
      const stats = await getCampaignStats('c1');
      expect(stats).toEqual({
        total_leads: 10,
        sent: 5,
        delivered: 4,
        opened: 2,
        replied: 1,
        failed: 3,
      });
    });

    it('handles no outreach rows', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ total: '0' }]))
        .mockResolvedValueOnce(mockQueryResult([]));
      const stats = await getCampaignStats('c1');
      expect(stats.total_leads).toBe(0);
      expect(stats.sent).toBe(0);
    });

    it('handles missing total row', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([]))
        .mockResolvedValueOnce(mockQueryResult([]));
      const stats = await getCampaignStats('c1');
      expect(stats.total_leads).toBe(0);
    });
  });
});
